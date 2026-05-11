# tests/test_integration.rb
# Full integration test: export active model to a temp JSON file and validate output.
# Run in SketchUp Ruby Console with a model open:
#   load 'full/path/to/bom_engine_plugin/tests/test_integration.rb'

require 'json'

module BOMEngine
  module Tests

    def self.run_full_export_test
      puts "\n=== BOM Engine: Integration Test ==="

      model = Sketchup.active_model
      if model.nil?
        puts "  SKIP No active model — open a .skp file first."
        return
      end

      out_path = File.join(Dir.tmpdir, "bom_engine_test_#{Time.now.to_i}.json")
      puts "  Output: #{out_path}"

      Core.run_export(
        output_path:      out_path,
        export_textures:  false,
        include_edges:    false,
        include_materials: true,
        pretty_print:     true
      )

      unless File.exist?(out_path)
        puts "  FAIL Output file was not created."
        return
      end

      data = JSON.parse(File.read(out_path))

      checks = {
        "schema_version present"             => data["schema_version"] == "2.0",
        "exported_at is ISO8601"             => data["exported_at"].to_s =~ /\d{4}-\d{2}-\d{2}T/,
        "entities is an Array"               => data["entities"].is_a?(Array),
        "spatial_analysis present"           => data["spatial_analysis"].is_a?(Hash),
        "materials is an Array"              => data["materials"].is_a?(Array),
        "tags is an Array"                   => data["tags"].is_a?(Array),
        "metadata.name present"              => !data.dig("metadata", "name").nil?,
        "units.output_unit == meters"        => data.dig("units", "output_unit") == "meters",
        "all entities have type field"       => data["entities"].all? { |e| e["type"] },
        "surface_summary present"            => data.dig("spatial_analysis", "surface_summary").is_a?(Hash),
        "openings array present"             => data.dig("spatial_analysis", "openings").is_a?(Array),
        "building_dimensions present"        => data.dig("spatial_analysis", "building_dimensions").is_a?(Hash),
      }

      pass       = 0
      fail_count = 0
      checks.each do |name, ok|
        if ok
          pass += 1
          puts "  PASS #{name}"
        else
          fail_count += 1
          puts "  FAIL #{name}"
        end
      end

      puts "\nIntegration Test: #{pass}/#{pass + fail_count} passed"
      puts "Output: #{out_path}"
      puts fail_count > 0 ? "SOME TESTS FAILED" : "ALL TESTS PASSED"
    end

  end
end

BOMEngine::Tests.run_full_export_test
