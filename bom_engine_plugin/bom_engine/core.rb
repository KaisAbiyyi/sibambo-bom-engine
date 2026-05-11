# bom_engine/core.rb
# Export controller — orchestrates all modules and registers SketchUp menu/toolbar.

require_relative 'constants'
require_relative 'logger'
require_relative 'traversal'
require_relative 'classifier'
require_relative 'opening_detector'
require_relative 'material_extractor'
require_relative 'spatial_analyzer'
require_relative 'json_builder'
require_relative 'texture_exporter'
require_relative 'ui_dialog'
require_relative 'observer'
require 'json'

module BOMEngine
  module Core

    # ── Menu & toolbar registration (runs once on load) ─────────────

    unless file_loaded?(__FILE__)
      plugins_menu = UI.menu("Plugins")
      bom_menu     = plugins_menu.add_submenu("BOM Engine")

      bom_menu.add_item("Export Model to JSON...") { export_with_dialog }
      bom_menu.add_item("Quick Export (last settings)") { quick_export }
      bom_menu.add_separator

      sel_item = bom_menu.add_item("Export Selection to JSON...") { export_selection_with_dialog }
      bom_menu.set_validation_proc(sel_item) do
        model = Sketchup.active_model
        model && !model.selection.empty? ? MF_ENABLED : MF_GRAYED
      end

      bom_menu.add_separator
      bom_menu.add_item("Toggle Real-Time Observer") { toggle_observer }
      bom_menu.add_separator
      bom_menu.add_item("About BOM Engine") { show_about }

      # Toolbar
      toolbar = UI::Toolbar.new("BOM Engine")
      cmd = UI::Command.new("Export JSON") { export_with_dialog }
      icon_path = File.join(File.dirname(__FILE__), "ui", "toolbar_icon.png")
      cmd.small_icon       = icon_path
      cmd.large_icon       = icon_path
      cmd.tooltip          = "BOM Engine: Export model to JSON"
      cmd.status_bar_text  = "Export SketchUp model to BOM Engine JSON"
      toolbar.add_item(cmd)
      toolbar.restore

      file_loaded(__FILE__)
    end

    # ── Main export entry points ────────────────────────────────────

    def self.export_with_dialog
      model = Sketchup.active_model
      if model.nil? || model.path.empty?
        UI.messagebox("Simpan model terlebih dahulu sebelum mengekspor.", MB_OK)
        return
      end
      has_selection = !model.selection.empty?
      UIDialog.show(has_selection: has_selection) { |settings| run_export(settings) }
    end

    def self.export_selection_with_dialog
      model = Sketchup.active_model
      if model.nil? || model.path.empty?
        UI.messagebox("Simpan model terlebih dahulu sebelum mengekspor.", MB_OK)
        return
      end
      if model.selection.empty?
        UI.messagebox("Tidak ada objek yang diseleksi.\nSeleksi dinding, atap, atau komponen lain terlebih dahulu.", MB_OK)
        return
      end
      UIDialog.show(has_selection: true, force_selection: true) { |settings| run_export(settings) }
    end

    def self.quick_export
      last = load_last_settings
      return export_with_dialog if last.nil?
      run_export(last)
    end

    # Run a full export with the given settings hash.
    #
    # @param settings [Hash]
    #   :output_path      [String]  path to output .json file
    #   :export_textures  [Boolean] write texture PNGs beside the JSON
    #   :include_edges    [Boolean] include edge entities
    #   :include_materials[Boolean] include material library
    #   :pretty_print     [Boolean] human-readable JSON formatting
    #   :selection_only   [Boolean] export only currently selected entities
    def self.run_export(settings)
      model    = Sketchup.active_model
      out_path = settings[:output_path].to_s

      if out_path.empty?
        UI.messagebox("Path output belum ditentukan.", MB_OK)
        return
      end

      selection_only = settings[:selection_only]

      # Validate selection mode
      if selection_only && model.selection.empty?
        UI.messagebox("Tidak ada objek yang diseleksi.\nGunakan Export Model untuk mengekspor seluruh model.", MB_OK)
        return
      end

      tex_dir = settings[:export_textures] ? out_path.gsub(".json", "_textures") : nil

      mode_label = selection_only ? "selection" : "full model"
      Logger.info("Export started [#{mode_label}] → #{out_path}")
      start_time = Time.now

      model.start_operation("BOM Engine Export", true)

      begin
        # Phase 1: texture writer (needed for UV extraction and texture export).
        # Some SketchUp builds do not expose an allocator for TextureWriter —
        # fall back to nil so the rest of the export still works without textures.
        tw = begin
          Sketchup::TextureWriter.new
        rescue => e
          Logger.warn("TextureWriter tidak tersedia (#{e.message}). Tekstur dilewati.")
          nil
        end

        # Disable texture export if TextureWriter is unavailable
        tex_dir = nil if tw.nil?

        # Phase 2: material library
        materials = MaterialExtractor.extract(model, tw, tex_dir)

        # Phase 3: entity tree walk — selection or full model
        walk_opts = { include_edges: settings[:include_edges] }

        if selection_only
          context_tf = active_context_transform(model)
          entities   = Traversal.walk(model.selection, tw, context_tf, 0, walk_opts)
          spatial    = SpatialAnalyzer.analyze_entities(model.selection, context_tf)
          Logger.info("Selection: #{model.selection.length} top-level entities")
        else
          identity = Geom::Transformation.new
          entities = Traversal.walk(model.entities, tw, identity, 0, walk_opts)
          spatial  = SpatialAnalyzer.analyze(model)
        end

        # Phase 4: assemble JSON payload
        payload = JSONBuilder.build(
          model:     model,
          entities:  entities,
          materials: materials,
          spatial:   spatial,
          settings:  settings
        )

        # Phase 5: write textures if requested
        TextureExporter.write_all(tw, tex_dir) if settings[:export_textures]

        # Phase 6: write JSON file
        content = settings[:pretty_print] == false ?
          JSON.generate(payload) :
          JSON.pretty_generate(payload)
        File.write(out_path, content, encoding: 'UTF-8')

        elapsed = (Time.now - start_time).round(2)
        Logger.info("Export complete in #{elapsed}s → #{out_path}")

        summary = selection_only ?
          "Seleksi: #{model.selection.length} objek dipilih\n" :
          "Entities: #{entities.length}\n"

        UI.messagebox(
          "Export selesai!\n\n" \
          "File: #{out_path}\n" \
          "#{summary}" \
          "Waktu: #{elapsed}s",
          MB_OK
        )

        save_last_settings(settings)

      rescue => e
        model.abort_operation
        Logger.error("Export failed: #{e.message}\n#{e.backtrace.first(5).join("\n")}")
        UI.messagebox("Export gagal:\n#{e.message}", MB_OK)
        return
      end

      model.commit_operation
    end

    # ── Selection helpers ────────────────────────────────────────────

    # Compute the world-space transformation of the current editing context.
    # When the user is inside a group/component, selected entities need this
    # transform applied so their coordinates are correct in world space.
    def self.active_context_transform(model)
      path = model.active_path
      return Geom::Transformation.new if path.nil? || path.empty?
      path.inject(Geom::Transformation.new) { |tf, entity| tf * entity.transformation }
    end

    # ── Observer toggle ─────────────────────────────────────────────

    def self.toggle_observer
      @observer_active = !@observer_active
      if @observer_active
        @model_observer = BOMObserver.new
        Sketchup.active_model.add_observer(@model_observer)
        UI.messagebox("Real-Time Observer: AKTIF\nBOM akan diperbarui setiap kali model berubah.", MB_OK)
      else
        Sketchup.active_model.remove_observer(@model_observer)
        @model_observer = nil
        UI.messagebox("Real-Time Observer: NONAKTIF", MB_OK)
      end
    end

    # ── Settings persistence ────────────────────────────────────────

    SETTINGS_KEY = "BOMEngine_LastSettings"

    def self.save_last_settings(settings)
      Sketchup.write_default(SETTINGS_KEY, "output_path",      settings[:output_path].to_s)
      Sketchup.write_default(SETTINGS_KEY, "export_textures",  settings[:export_textures].to_s)
      Sketchup.write_default(SETTINGS_KEY, "include_edges",    settings[:include_edges].to_s)
      Sketchup.write_default(SETTINGS_KEY, "include_materials", settings[:include_materials].to_s)
      Sketchup.write_default(SETTINGS_KEY, "pretty_print",     settings[:pretty_print].to_s)
    end

    def self.load_last_settings
      path = Sketchup.read_default(SETTINGS_KEY, "output_path")
      return nil if path.nil? || path.empty?
      {
        output_path:      path,
        export_textures:  Sketchup.read_default(SETTINGS_KEY, "export_textures")  == "true",
        include_edges:    Sketchup.read_default(SETTINGS_KEY, "include_edges")    == "true",
        include_materials: Sketchup.read_default(SETTINGS_KEY, "include_materials") != "false",
        pretty_print:     Sketchup.read_default(SETTINGS_KEY, "pretty_print")     != "false"
      }
    end

    def self.show_about
      UI.messagebox(
        "BOM Engine Exporter v#{BOMEngine::PLUGIN_VERSION}\n\n" \
        "Mengekspor model SketchUp ke JSON terstruktur\n" \
        "untuk estimasi biaya konstruksi berbasis SNI-AHSP.\n\n" \
        "Proyek Riset — Sibambo 2026",
        MB_OK
      )
    end

  end
end
