# Run from SketchUp Ruby Console:
# load 'D:/projects/sibambo-bom-engine/bom_engine_plugin/bom_engine/tests/test_bome2.rb'

require 'fileutils'
require 'json'
require 'tmpdir'
require 'zlib'
require_relative '../quantizer'
require_relative '../bome2_writer'

module BOMEngine
  module Tests
    module BOME2Test
      module_function

      def assert(condition, message)
        raise "FAIL: #{message}" unless condition
        puts "PASS: #{message}"
      end

      def run
        graph = JSON.parse(
          File.read(File.expand_path('../../examples/canonical-v3-small.json', __dir__)),
          symbolize_names: true
        )
        graph[:meshes][0][:positions_m] = [
          0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
          0.25, 0.25, 0, 0.25, 0.75, 0, 0.75, 0.75, 0, 0.75, 0.25, 0
        ]
        graph[:meshes][0][:faces][0][:holes] = [[4, 5, 6, 7]]
        graph[:meshes][0][:faces][0][:triangles] = [
          0, 1, 7, 0, 7, 4,
          1, 2, 6, 1, 6, 7,
          2, 3, 5, 2, 5, 6,
          3, 0, 4, 3, 4, 5
        ]
        root_definition = graph[:definitions][0]
        root_definition[:mesh_id] = nil
        root_definition[:node_ids] = %w[node:instance:1 node:instance:2]
        component_definition = {
          id: 'definition:component:panel',
          kind: 'component_definition',
          name: 'Panel',
          mesh_id: graph[:meshes][0][:id],
          node_ids: []
        }
        graph[:definitions] << component_definition
        graph[:meshes][0][:definition_id] = component_definition[:id]
        graph[:transforms] << [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1]
        graph[:transforms] << [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1]
        graph[:nodes] << {
          id: 'node:instance:1', kind: 'component_instance', name: 'Panel 1',
          owner_definition_id: root_definition[:id], definition_id: component_definition[:id], transform_id: 1
        }
        graph[:nodes] << {
          id: 'node:instance:2', kind: 'component_instance', name: 'Panel 2',
          owner_definition_id: root_definition[:id], definition_id: component_definition[:id], transform_id: 2
        }

        quantized = Quantizer.quantize_positions(graph[:meshes][0][:positions_m])
        assert(%w[uint16 uint32].include?(quantized[:component_type]), 'adaptive integer component type')
        assert(quantized[:measured_max_error_m] <= Quantizer::MAX_ERROR_M, 'quantization stays inside error budget')
        assert(measured_error(graph[:meshes][0][:positions_m], quantized) <= quantized[:measured_max_error_m] + 1.0e-12, 'declared error is measured')

        bytes = BOME2Writer.pack(graph)
        assert(bytes.start_with?(BOME2Writer::MAGIC), 'BOME2 magic')
        manifest_only = BOME2Writer.read_manifest(bytes)
        assert(manifest_only[:manifest][:format][:version] == '2.0.0', 'manifest-only decode')
        assert(manifest_only[:sections].length == 4, 'progressive section directory')
        assert(manifest_only[:manifest][:meshes].length == 1, 'shared mesh emitted once')
        assert(manifest_only[:manifest][:nodes].count { |node| node[:kind] == 2 } == 2, 'two component instances reference shared definition')
        assert(manifest_only[:manifest][:strings].uniq.length == manifest_only[:manifest][:strings].length, 'string table deduplicated')

        validation = BOME2Writer.validate(bytes)
        assert(validation[:meshes] == 1 && validation[:triangles] == 8, 'indexed triangle buffer validates')
        assert(validation[:instances] == 2, 'instance count validates')

        corrupt = bytes.dup
        corrupt.setbyte(corrupt.bytesize - 1, corrupt.getbyte(corrupt.bytesize - 1) ^ 0xff)
        rejected = begin
          BOME2Writer.validate(corrupt)
          false
        rescue StandardError => error
          error.message.include?('checksum')
        end
        assert(rejected, 'corrupt section checksum rejected')

        directory = manifest_only[:sections]
        bad_directory = bytes.dup
        first_directory_offset = BOME2Writer::MAGIC.bytesize + BOME2Writer::FIXED_HEADER_BYTES + manifest_only[:header_bytes]
        bad_directory[first_directory_offset + 8, 4] = [bytes.bytesize + 64].pack('V')
        assert_raises('section bounds rejected') { BOME2Writer.validate(bad_directory) }

        output_dir = Dir.mktmpdir('bome2-test')
        path = File.join(output_dir, 'fixture.bome.gz')
        result = BOME2Writer.write(path, graph, compress: true)
        inflated = Zlib::GzipReader.open(path, &:read)
        unless inflated.b == bytes.b
          first_difference = [inflated.bytesize, bytes.bytesize].min.times.find { |index| inflated.getbyte(index) != bytes.getbyte(index) }
          raise "gzip round-trip differs at #{first_difference}; #{inflated.bytesize} vs #{bytes.bytesize}; #{Digest::SHA256.hexdigest(inflated)} vs #{Digest::SHA256.hexdigest(bytes)}"
        end
        assert(true, 'gzip round-trip is deterministic')
        assert(result[:bytes] == File.size(path), 'writer reports compressed bytes')

        puts 'BOME2 Tests: ALL PASSED'
        true
      rescue => error
        puts "BOME2 Tests: FAILED\n#{error.class}: #{error.message}"
        puts error.backtrace.first(8)
        false
      ensure
        FileUtils.remove_entry(output_dir) if output_dir && Dir.exist?(output_dir)
      end

      def measured_error(source, quantized)
        decoded = Quantizer.dequantize_positions(quantized)
        source.each_slice(3).with_index.map do |point, index|
          offset = index * 3
          Math.sqrt(3.times.sum { |axis| (point[axis] - decoded[offset + axis])**2 })
        end.max || 0.0
      end

      def assert_raises(message)
        raised = false
        begin
          yield
        rescue StandardError
          raised = true
        end
        assert(raised, message)
      end
    end
  end
end

BOMEngine::Tests::BOME2Test.run
