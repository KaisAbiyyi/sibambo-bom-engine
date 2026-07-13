# tests/test_canonical_writer.rb
# Run in SketchUp Ruby Console:
#   load 'D:/projects/sibambo-bom-engine/bom_engine_plugin/bom_engine/tests/test_canonical_writer.rb'

require 'json'
require 'tmpdir'
require 'zlib'
require_relative '../constants'
require_relative '../traversal'
require_relative '../canonical_graph_builder'
require_relative '../canonical_json_writer'

module BOMEngine
  module Tests
    module CanonicalWriterTest
      module_function

      def run
        puts "\n=== BOM Engine: Canonical Writer Tests ==="
        model = Sketchup.active_model
        raise 'No active SketchUp model' unless model

        json_path = File.join(Dir.tmpdir, "bom_engine_v3_writer_#{Time.now.to_i}.json")
        gzip_path = "#{json_path}.gz"
        model.start_operation('BOM Engine Canonical Writer Test', true)
        begin
          group = model.entities.add_group
          group.entities.add_face([0, 0, 0], [12, 0, 0], [12, 12, 0], [0, 12, 0])
          graph = CanonicalGraphBuilder.build(
            model: model,
            entities: group.entities,
            parent_transform: Geom::Transformation.new,
            settings: { selection_only: true, include_edges: false },
            spatial: {}
          )

          CanonicalJSONWriter.write(json_path, graph, pretty: true, compress: false)
          CanonicalJSONWriter.write(gzip_path, graph, pretty: false, compress: true)

          readable = File.read(json_path, encoding: 'UTF-8')
          parsed = JSON.parse(readable)
          compressed = Zlib::GzipReader.open(gzip_path) { |gzip| JSON.parse(gzip.read) }

          raise 'pretty JSON is not readable/indented' unless readable.include?("\n  \"format\"")
          raise 'plain JSON version mismatch' unless parsed.dig('format', 'version') == '3.0.0'
          raise 'gzip JSON version mismatch' unless compressed.dig('format', 'version') == '3.0.0'
          raise 'writer byte count mismatch' unless CanonicalJSONWriter.last_result[:bytes] == File.size(gzip_path)
        ensure
          model.abort_operation
          File.delete(json_path) if File.exist?(json_path)
          File.delete(gzip_path) if File.exist?(gzip_path)
        end

        puts 'Canonical Writer Tests: ALL PASSED'
        true
      end
    end
  end
end

BOMEngine::Tests::CanonicalWriterTest.run
