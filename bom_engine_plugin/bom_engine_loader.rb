# bom_engine_loader.rb
# Entry point for BOM Engine SketchUp Plugin
# Auto-loaded by SketchUp from the Plugins directory.

require 'sketchup'
require 'extensions'

module BOMEngine
  PLUGIN_VERSION = "2.0.0"
  PLUGIN_PATH    = File.dirname(__FILE__)

  # Register as SketchUp Extension (enables/disables via Preferences > Extensions)
  extension = SketchupExtension.new(
    "BOM Engine Exporter",
    File.join(PLUGIN_PATH, "bom_engine", "core.rb")
  )
  extension.description = "Exports SketchUp model geometry and metadata to " \
                          "structured JSON for BOM cost estimation."
  extension.version     = PLUGIN_VERSION
  extension.creator     = "Sibambo Research Team"
  extension.copyright   = "© 2026 Sibambo"

  Sketchup.register_extension(extension, true)
end
