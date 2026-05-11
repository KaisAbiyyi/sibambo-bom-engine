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
    #   :include_materials, :pretty_print, :selection_only
    def self.show(has_selection: false, force_selection: false, &callback)
      dialog = UI::HtmlDialog.new(
        dialog_title: "BOM Engine — Export Settings",
        scrollable:   false,
        resizable:    false,
        width:        480,
        height:       460,
        min_width:    400,
        min_height:   380,
        style:        UI::HtmlDialog::STYLE_DIALOG
      )

      html_path = File.join(File.dirname(__FILE__), "ui", "export_dialog.html")
      dialog.set_file(html_path)

      model = Sketchup.active_model
      default_path = model.path.empty? ?
        File.join(Dir.home, "bom_export.json") :
        model.path.gsub(".skp", "_bom.json")

      dialog.add_action_callback("onReady") do |_ctx|
        escaped = default_path.gsub("\\", "\\\\").gsub("'", "\\'")
        dialog.execute_script("setDefaultPath('#{escaped}')")
        dialog.execute_script("setSelectionState(#{has_selection}, #{force_selection})")
      end

      dialog.add_action_callback("browse") do |_ctx|
        chosen = UI.savepanel("Save BOM JSON", File.dirname(default_path), "*.json")
        if chosen
          escaped = chosen.gsub("\\", "\\\\").gsub("'", "\\'")
          dialog.execute_script("setPath('#{escaped}')")
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
