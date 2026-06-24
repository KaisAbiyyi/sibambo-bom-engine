# bom_engine/observer.rb
# Real-time model observer — fires a debounced re-export to a temp JSON file
# whenever the model is modified. Used for live BOM preview in the web frontend.

module BOMEngine

  class BOMObserver < Sketchup::ModelObserver

    DEBOUNCE_DELAY = 1.5  # seconds — wait for user to stop editing before re-export

    def initialize
      @timer     = nil
      @temp_path = File.join(Dir.tmpdir, "bom_engine_live.json")
      Logger.info("BOM Observer initialized. Live output: #{@temp_path}")
    end

    def onTransactionCommit(model)
      debounced_export(model)
    end

    def onTransactionAbort(_model)
      # no-op — aborted operations don't change model state
    end

    private

    def debounced_export(_model)
      # Cancel any pending export if the user is still making changes
      UI.stop_timer(@timer) if @timer
      @timer = UI.start_timer(DEBOUNCE_DELAY, false) do
        begin
          Core.run_export(
            output_path:    @temp_path,
            export_level:   "visual",
            export_textures: false,
            include_edges:  false,
            pretty_print:   false,
            compress_output: true,
            compact_geometry: true,
            binary_geometry: true
          )
          Logger.info("Live export updated: #{@temp_path}")
        rescue => e
          Logger.error("Live export failed: #{e.message}")
        end
        @timer = nil
      end
    end

  end

end
