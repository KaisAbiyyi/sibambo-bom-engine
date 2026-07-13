# Run from SketchUp Ruby Console:
# load 'D:/projects/sibambo-bom-engine/bom_engine_plugin/bom_engine/tests/test_core_canonical_export.rb'

require 'json'
require 'fileutils'
require 'tmpdir'
require 'zlib'

module BOMEngine
  module Tests
    module CoreCanonicalExportTest
      module_function

      def assert(condition, message)
        raise "FAIL: #{message}" unless condition
        puts "PASS: #{message}"
      end

      def run
        model = Sketchup.active_model
        old_selection = model.selection.to_a
        old_modified = model.modified?
        output_dir = Dir.mktmpdir('bom-engine-canonical-core')

        model.start_operation('BOM Engine canonical Core test fixture', true)
        group = model.entities.add_group
        group.name = 'Canonical Core Fixture'
        group.entities.add_face(
          [0, 0, 0],
          [24, 0, 0],
          [24, 12, 0],
          [0, 12, 0]
        )
        model.selection.clear
        model.selection.add(group)

        readable_result = Core.export_canonical(
          model,
          output_path: File.join(output_dir, 'fixture_bom.json'),
          selection_only: true,
          include_edges: false,
          include_materials: true,
          export_textures: false,
          pretty_print: true,
          compress_output: false,
          silent: true
        )

        assert(readable_result[:path].end_with?('_canonical.json'), 'readable canonical suffix is deterministic')
        assert(File.file?(readable_result[:path]), 'readable canonical output exists')
        assert(File.binread(readable_result[:path], 2) != "\x1f\x8b", 'readable output is not gzip')

        content = File.read(readable_result[:path], encoding: 'UTF-8')
        graph = JSON.parse(content)
        assert(content.include?("\n  \"format\""), 'readable output uses two-space indentation')
        assert(graph.dig('format', 'version') == '3.0.0', 'Core writes canonical v3')
        assert(graph.dig('source', 'scope') == 'selection', 'selection scope is preserved')
        assert(graph.fetch('nodes').any? { |node| node['kind'] == 'group_instance' }, 'selection hierarchy is preserved')
        assert(readable_result[:bytes] == File.size(readable_result[:path]), 'Core reports readable byte size')

        gzip_result = Core.export_canonical(
          model,
          output_path: File.join(output_dir, 'fixture_bom.json'),
          selection_only: true,
          include_edges: false,
          include_materials: true,
          export_textures: false,
          pretty_print: false,
          compress_output: true,
          silent: true
        )
        assert(gzip_result[:path].end_with?('_canonical.json.gz'), 'compressed canonical suffix is deterministic')
        assert(File.file?(gzip_result[:path]), 'compressed canonical output exists')
        compressed = Zlib::GzipReader.open(gzip_result[:path], &:read)
        assert(JSON.parse(compressed).dig('format', 'version') == '3.0.0', 'compressed output remains valid JSON')

        puts 'Core Canonical Export Tests: ALL PASSED'
        true
      rescue => error
        puts "Core Canonical Export Tests: FAILED\n#{error.class}: #{error.message}"
        puts error.backtrace.first(8)
        false
      ensure
        model.abort_operation if model
        if model
          model.selection.clear
          old_selection.each { |entity| model.selection.add(entity) if entity.valid? }
          model.modified = old_modified if model.respond_to?(:modified=)
        end
        FileUtils.remove_entry(output_dir) if output_dir && Dir.exist?(output_dir)
      end
    end
  end
end

BOMEngine::Tests::CoreCanonicalExportTest.run
