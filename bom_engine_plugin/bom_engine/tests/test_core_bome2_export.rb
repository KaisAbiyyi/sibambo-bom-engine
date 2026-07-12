# Run from SketchUp Ruby Console:
# load 'D:/projects/sibambo-bom-engine/bom_engine_plugin/bom_engine/tests/test_core_bome2_export.rb'

require 'fileutils'
require 'tmpdir'

module BOMEngine
  module Tests
    module CoreBOME2ExportTest
      module_function

      def assert(condition, message)
        raise "FAIL: #{message}" unless condition
        puts "PASS: #{message}"
      end

      def run
        model = Sketchup.active_model
        old_selection = model.selection.to_a
        output_dir = Dir.mktmpdir('bom-engine-bome2-core')
        model.start_operation('BOM Engine BOME2 Core test fixture', true)
        definition = model.definitions.add("BOME2 Core Fixture #{Time.now.to_f}")
        definition.entities.add_face([0, 0, 0], [24, 0, 0], [24, 12, 0], [0, 12, 0])
        first = model.entities.add_instance(definition, Geom::Transformation.translation([10, 0, 0]))
        second = model.entities.add_instance(definition, Geom::Transformation.translation([20, 0, 0]))
        model.selection.clear
        model.selection.add(first)
        model.selection.add(second)

        result = Core.export_bome2(
          model,
          output_path: File.join(output_dir, 'fixture_bom.json'),
          selection_only: true,
          include_edges: false,
          export_textures: false,
          compress_output: true,
          silent: true
        )
        assert(result[:path].end_with?('_runtime.bome2.gz'), 'runtime suffix is deterministic')
        assert(File.file?(result[:path]), 'BOME2 gzip output exists')
        bytes = Zlib::GzipReader.open(result[:path], &:read)
        validation = BOME2Writer.validate(bytes)
        assert(validation[:format] == '2.0.0', 'Core writes BOME2 v2')
        assert(validation[:instances] == 2, 'Core preserves two component instances')
        assert(validation[:meshes] == 1, 'Core writes shared definition mesh once')
        assert(result[:bytes] == File.size(result[:path]), 'Core reports written bytes')
        assert(result[:quantization_max_error_m] <= Quantizer::MAX_ERROR_M, 'Core reports bounded quantization')
        puts 'Core BOME2 Export Tests: ALL PASSED'
        true
      rescue => error
        puts "Core BOME2 Export Tests: FAILED\n#{error.class}: #{error.message}"
        puts error.backtrace.first(8)
        false
      ensure
        model.abort_operation if model
        if model
          model.selection.clear
          old_selection.each { |entity| model.selection.add(entity) if entity.valid? }
        end
        FileUtils.remove_entry(output_dir) if output_dir && Dir.exist?(output_dir)
      end
    end
  end
end

BOMEngine::Tests::CoreBOME2ExportTest.run
