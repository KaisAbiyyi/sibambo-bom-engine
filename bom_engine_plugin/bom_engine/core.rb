# bom_engine/core.rb
# Export controller — orchestrates all modules and registers SketchUp menu/toolbar.

require_relative 'constants'
require_relative 'logger'
require_relative 'traversal'
require_relative 'compact_mesh_builder'
require_relative 'binary_mesh_writer'
require_relative 'binary_mesh_validator'
require_relative 'classifier'
require_relative 'opening_detector'
require_relative 'material_extractor'
require_relative 'spatial_analyzer'
require_relative 'json_builder'
require_relative 'canonical_graph_builder'
require_relative 'canonical_json_writer'
require_relative 'quantizer'
require_relative 'bome2_writer'
require_relative 'texture_exporter'
require_relative 'binary_mesh_streamer'
require_relative 'ui_dialog'
require_relative 'observer'
require 'json'
require 'zlib'

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
      cmd = UI::Command.new("Export Model") { export_with_dialog }
      icon_path = File.join(File.dirname(__FILE__), "ui", "toolbar_icon.png")
      cmd.small_icon       = icon_path
      cmd.large_icon       = icon_path
      cmd.tooltip          = "BOM Engine: Export model to BOME/JSON"
      cmd.status_bar_text  = "Export SketchUp model to BOM Engine BOME/JSON"
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
    #   :compress_output  [Boolean] gzip output
    #   :compact_geometry [Boolean] legacy setting; Visual/Standard always use compact mesh
    #   :binary_geometry  [Boolean] legacy setting; Visual/Standard always use .bome/.bome.gz
    #   :output_format    [String]  canonical_v3 or legacy (default)
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

      if settings[:output_format].to_s == "canonical_v3"
        begin
          result = export_canonical(model, settings)
          unless settings[:silent]
            stats = result[:statistics]
            UI.messagebox(
              "Export canonical selesai!\n\n" \
              "File: #{result[:path]}\n" \
              "Definitions: #{stats[:definitions]}\n" \
              "Instances: #{stats[:component_instances].to_i + stats[:group_instances].to_i}\n" \
              "Faces: #{stats[:faces]}\n" \
              "Ukuran: #{result[:bytes]} bytes\n" \
              "Waktu: #{result[:elapsed_seconds]}s",
              MB_OK
            )
          end
          save_last_settings(settings.merge(output_path: result[:path]))
          return result
        rescue => e
          Logger.error("Canonical export failed: #{e.message}\n#{e.backtrace.first(5).join("\n")}")
          UI.messagebox("Export canonical gagal:\n#{e.message}", MB_OK) unless settings[:silent]
          return nil
        end
      end

      if settings[:output_format].to_s == "bome2"
        begin
          result = export_bome2(model, settings)
          unless settings[:silent]
            UI.messagebox(
              "Export runtime selesai!\n\n" \
              "File: #{result[:path]}\n" \
              "Unique meshes: #{result[:meshes]}\n" \
              "Instances: #{result[:instances]}\n" \
              "Triangles: #{result[:triangles]}\n" \
              "Quantization error max: #{result[:quantization_max_error_m]}m\n" \
              "Ukuran: #{result[:bytes]} bytes\n" \
              "Waktu: #{result[:elapsed_seconds]}s",
              MB_OK
            )
          end
          save_last_settings(settings.merge(output_path: result[:path]))
          return result
        rescue => e
          Logger.error("BOME2 export failed: #{e.message}\n#{e.backtrace.first(5).join("\n")}")
          UI.messagebox("Export runtime gagal:\n#{e.message}", MB_OK) unless settings[:silent]
          return nil
        end
      end

      # Append export level suffix before .json extension.
      level_tag = settings[:export_level].to_s
      level_tag = "full" unless %w[visual standard full].include?(level_tag)
      base_path = out_path.sub(/\.(?:json|bome)(?:\.gz)?$/i, "")
      base_path = base_path.sub(/_(?:visual|standard|full)$/i, "")

      tex_dir = settings[:export_textures] ? "#{base_path}_#{level_tag}_textures" : nil

      mode_label = selection_only ? "selection" : "full model"
      Logger.info("Export started [#{mode_label}] → #{out_path}")
      start_time = Time.now

      model.start_operation("BOM Engine Export", true)

      begin
        level = settings[:export_level].to_s
        level = "full" unless %w[visual standard full].include?(level)

        # Phase 1: texture writer — only needed for Full level UV extraction/export
        tw = nil
        if level == "full"
          tw = begin
            Sketchup.create_texture_writer
          rescue => e
            Logger.warn("TextureWriter tidak tersedia (#{e.message}). Tekstur dilewati.")
            nil
          end
        end

        # Texture files and UV data only apply to Full exports.
        tex_dir = nil if level != "full"

        # Phase 2: material library — only for Full level
        materials = (level == "full") ? MaterialExtractor.extract(model, tw, tex_dir) : []

        # Visual/Standard are viewer payloads. Force binary compact mesh so old
        # checkbox/default state cannot accidentally write huge per-face JSON.
        compact_geometry = level != "full"
        binary_geometry = compact_geometry
        out_ext = binary_geometry ? "bome" : "json"
        out_path = "#{base_path}_#{level_tag}.#{out_ext}"
        out_path += ".gz" if settings[:compress_output]
        settings = settings.merge(output_path: out_path, export_level: level, binary_geometry: binary_geometry)
        Logger.info("Export target: #{out_path}")

        # Phase 3: entity tree walk — selection or full model
        identity  = Geom::Transformation.new
        walk_opts = { include_edges: settings[:include_edges], export_level: level }
        compact_mesh = nil
        stats = nil
        output_written = false

        if selection_only
          context_tf = active_context_transform(model)
          spatial    = (level == "full") ? SpatialAnalyzer.analyze_entities(model.selection, context_tf) : {}
          if binary_geometry
            stats = BinaryMeshStreamer.export(
              out_path: out_path,
              model: model,
              entities: model.selection,
              parent_tf: context_tf,
              settings: settings,
              materials: materials,
              spatial: spatial,
              compress: settings[:compress_output]
            )
            entities = []
            output_written = true
          elsif compact_geometry
            compact_result = CompactMeshBuilder.build(model.selection, context_tf, walk_opts)
            compact_mesh = compact_result[:mesh]
            stats = compact_result[:stats]
            entities = []
          else
            entities = Traversal.walk(model.selection, tw, context_tf, 0, walk_opts)
          end
          Logger.info("Selection: #{model.selection.length} top-level entities")
        else
          spatial  = (level == "full") ? SpatialAnalyzer.analyze(model) : {}
          if binary_geometry
            stats = BinaryMeshStreamer.export(
              out_path: out_path,
              model: model,
              entities: model.entities,
              parent_tf: identity,
              settings: settings,
              materials: materials,
              spatial: spatial,
              compress: settings[:compress_output]
            )
            entities = []
            output_written = true
          elsif compact_geometry
            compact_result = CompactMeshBuilder.build(model.entities, identity, walk_opts)
            compact_mesh = compact_result[:mesh]
            stats = compact_result[:stats]
            entities = []
          else
            entities = Traversal.walk(model.entities, tw, identity, 0, walk_opts)
          end
        end

        # Phase 4: assemble JSON payload
        unless output_written
          payload = JSONBuilder.build(
            model:     model,
            entities:  entities,
            materials: materials,
            spatial:   spatial,
            settings:  settings,
            compact_mesh: compact_mesh
          )

          # Phase 5: write output file
          content = settings[:pretty_print] ? JSON.pretty_generate(payload) : JSON.generate(payload)
          if settings[:compress_output]
            Zlib::GzipWriter.open(out_path) { |gzip| gzip.write(content) }
          else
            File.open(out_path, 'w:UTF-8') { |file| file.write(content) }
          end
        end

        if binary_geometry
          validation = BinaryMeshValidator.validate(out_path)
          Logger.info("BOME validated: #{validation[:face_count]} faces, #{validation[:position_count]} position ints")
        end

        elapsed = (Time.now - start_time).round(2)
        Logger.info("Export complete in #{elapsed}s → #{out_path}")

        stats ||= export_stats(entities)
        summary = selection_only ?
          "Seleksi: #{model.selection.length} objek dipilih\n" :
          "Top-level entities: #{compact_geometry ? model.entities.length : entities.length}\n"
        summary += "Format: #{binary_geometry ? 'binary mesh v1' : compact_geometry ? 'compact mesh v1' : 'legacy entities'}\n"
        summary += "Renderable faces: #{stats[:faces]}\n"
        summary += "Roof slope faces: #{stats[:roof_slope_faces]}\n"

        unless settings[:silent]
          UI.messagebox(
            "Export selesai!\n\n" \
            "File: #{out_path}\n" \
            "#{summary}" \
            "Waktu: #{elapsed}s",
            MB_OK
          )
        end

        save_last_settings(settings)

      rescue => e
        model.abort_operation
        Logger.error("Export failed: #{e.message}\n#{e.backtrace.first(5).join("\n")}")
        UI.messagebox("Export gagal:\n#{e.message}", MB_OK) unless settings[:silent]
        return
      end

      model.commit_operation
    end

    # Export canonical JSON v3 without expanding component instances.
    # Kept separate from the legacy exporter so existing APIs and output remain stable.
    def self.export_canonical(model, settings)
      started_at = Time.now
      output_path = canonical_output_path(settings[:output_path], settings[:compress_output])
      graph = build_canonical_graph(model, settings, output_path)
      result = CanonicalJSONWriter.write(
        output_path,
        graph,
        pretty: settings[:pretty_print] == true,
        compress: settings[:compress_output] == true
      )
      elapsed = (Time.now - started_at).round(3)
      Logger.info("Canonical export complete in #{elapsed}s -> #{output_path}")
      result.merge(
        elapsed_seconds: elapsed,
        format: 'canonical_v3',
        statistics: graph[:statistics]
      )
    end

    def self.export_bome2(model, settings)
      started_at = Time.now
      output_path = bome2_output_path(settings[:output_path], settings[:compress_output])
      graph = build_canonical_graph(model, settings.merge(output_format: 'bome2'), output_path)
      result = BOME2Writer.write(output_path, graph, compress: settings[:compress_output] == true)
      bytes = if settings[:compress_output] == true
                Zlib::GzipReader.open(output_path, &:read)
              else
                File.binread(output_path)
              end
      validation = BOME2Writer.validate(bytes)
      elapsed = (Time.now - started_at).round(3)
      Logger.info("BOME2 export complete in #{elapsed}s -> #{output_path}")
      result.merge(validation).merge(elapsed_seconds: elapsed, format: 'bome2')
    end

    def self.build_canonical_graph(model, settings, output_path)
      selection_only = settings[:selection_only] == true
      entities = selection_only ? model.selection : model.entities
      parent_transform = selection_only ? active_context_transform(model) : Geom::Transformation.new
      texture_writer = begin
        Sketchup.create_texture_writer
      rescue => e
        Logger.warn("TextureWriter tidak tersedia (#{e.message}). UV dilewati.")
        nil
      end
      texture_dir = nil
      if settings[:export_textures]
        texture_dir = output_path.sub(/\.(?:json|bome2)(?:\.gz)?$/i, '_textures')
        MaterialExtractor.extract(model, texture_writer, texture_dir)
      end
      spatial = if selection_only
                  SpatialAnalyzer.analyze_entities(entities, parent_transform)
                else
                  SpatialAnalyzer.analyze(model)
                end
      canonical_settings = settings.merge(
        export_level: 'full',
        selection_only: selection_only,
        texture_directory: texture_dir
      )
      CanonicalGraphBuilder.build(
        model: model,
        entities: entities,
        parent_transform: parent_transform,
        settings: canonical_settings,
        spatial: spatial,
        texture_writer: texture_writer
      )
    end

    def self.canonical_output_path(output_path, compress)
      base_path = output_path.to_s.sub(/\.(?:json|bome)(?:\.gz)?$/i, '')
      base_path = base_path.sub(/_(?:visual|standard|full|canonical)$/i, '')
      path = "#{base_path}_canonical.json"
      compress ? "#{path}.gz" : path
    end

    def self.bome2_output_path(output_path, compress)
      base_path = output_path.to_s.sub(/\.(?:json|bome|bome2)(?:\.gz)?$/i, '')
      base_path = base_path.sub(/_(?:visual|standard|full|canonical|runtime)$/i, '')
      path = "#{base_path}_runtime.bome2"
      compress ? "#{path}.gz" : path
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

    def self.export_stats(entities, stats = { faces: 0, roof_slope_faces: 0 })
      entities.each do |entity|
        if entity[:type] == "Face"
          stats[:faces] += 1
          stats[:roof_slope_faces] += 1 if entity[:surface_type] == "roof_slope"
        end
        export_stats(entity[:children], stats) if entity[:children].is_a?(Array)
      end
      stats
    end

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
      Sketchup.write_default(SETTINGS_KEY, "output_path",       settings[:output_path].to_s)
      Sketchup.write_default(SETTINGS_KEY, "export_level",      settings[:export_level].to_s)
      Sketchup.write_default(SETTINGS_KEY, "export_textures",   settings[:export_textures].to_s)
      Sketchup.write_default(SETTINGS_KEY, "include_edges",     settings[:include_edges].to_s)
      Sketchup.write_default(SETTINGS_KEY, "include_materials", settings[:include_materials].to_s)
      Sketchup.write_default(SETTINGS_KEY, "pretty_print",      settings[:pretty_print].to_s)
      Sketchup.write_default(SETTINGS_KEY, "compress_output",   settings[:compress_output].to_s)
      Sketchup.write_default(SETTINGS_KEY, "compact_geometry",  settings[:compact_geometry].to_s)
      Sketchup.write_default(SETTINGS_KEY, "binary_geometry",   settings[:binary_geometry].to_s)
      Sketchup.write_default(SETTINGS_KEY, "output_format",     settings[:output_format].to_s)
    end

    def self.load_last_settings
      path = Sketchup.read_default(SETTINGS_KEY, "output_path")
      return nil if path.nil? || path.empty?
      level = Sketchup.read_default(SETTINGS_KEY, "export_level").to_s
      level = "visual" unless %w[visual standard full].include?(level)
      {
        output_path:       path,
        export_level:      level,
        export_textures:   Sketchup.read_default(SETTINGS_KEY, "export_textures")   == "true",
        include_edges:     Sketchup.read_default(SETTINGS_KEY, "include_edges")     == "true",
        include_materials: Sketchup.read_default(SETTINGS_KEY, "include_materials") != "false",
        pretty_print:      Sketchup.read_default(SETTINGS_KEY, "pretty_print")      == "true",
        compress_output:   Sketchup.read_default(SETTINGS_KEY, "compress_output")   != "false",
        compact_geometry:  Sketchup.read_default(SETTINGS_KEY, "compact_geometry")  != "false",
        binary_geometry:   Sketchup.read_default(SETTINGS_KEY, "binary_geometry")   != "false",
        output_format:     Sketchup.read_default(SETTINGS_KEY, "output_format").to_s
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
