# bom_engine/ui_dialog.rb
# Shows the HtmlDialog export settings panel and calls back with chosen settings.

require 'json'

module BOMEngine
  module UIDialog

    # Display the export dialog.
    # Yields a settings Hash when the user clicks Export.
    #
    # @param has_selection   [Boolean] whether entities are currently selected
    # @param force_selection [Boolean] pre-check and lock the selection checkbox
    # @yield [Hash] settings with keys:
    #   :output_path, :export_textures, :include_edges,
    #   :include_materials, :pretty_print, :compress_output,
    #   :compact_geometry, :binary_geometry, :selection_only
    def self.show(has_selection: false, force_selection: false, &callback)
      dialog = UI::HtmlDialog.new(
        dialog_title: "BOM Engine — Export Settings",
        scrollable:   true,
        resizable:    true,
        width:        480,
        height:       620,
        min_width:    360,
        min_height:   360,
        style:        UI::HtmlDialog::STYLE_DIALOG
      )

      html_path = File.join(File.dirname(__FILE__), "ui", "export_dialog.html")
      dialog.set_file(html_path)

      model = Sketchup.active_model
      default_path = model.path.empty? ?
        File.join(Dir.home, "bom_export.bome") :
        File.join(
          File.dirname(model.path),
          "#{File.basename(model.path, File.extname(model.path))}_bom.bome"
        )

      dialog.add_action_callback("onReady") do |_ctx|
        dialog.execute_script("setDefaultPath(#{JSON.generate(default_path)})")
        dialog.execute_script("setSelectionState(#{has_selection}, #{force_selection})")
      end

      dialog.add_action_callback("browse") do |_ctx|
        chosen = UI.savepanel(
          "Save BOM Engine Model",
          File.dirname(default_path),
          File.basename(default_path)
        )
        if chosen
          dialog.execute_script("setPath(#{JSON.generate(chosen)})")
        end
      end

      dialog.add_action_callback("export") do |_ctx, settings_json|
        settings = JSON.parse(settings_json, symbolize_names: true) rescue {}
        dialog.close
        callback.call(settings) if callback
      end

      dialog.add_action_callback("cancel") { |_ctx| dialog.close }

      dialog.show
    end

  end
end
