# Run with standalone Ruby:
#   ruby bom_engine_plugin/bom_engine/tests/test_model_eval_json_writer.rb

require 'json'
require 'tmpdir'
require 'fileutils'
require_relative '../quantizer'
require_relative '../model_eval_json_writer'

module BOMEngine
  module Tests
    module ModelEvalJSONWriterTest
      module_function

      def assert(condition, message)
        raise "FAIL: #{message}" unless condition
        puts "PASS: #{message}"
      end

      def run
        graph = JSON.parse(File.read(File.expand_path('../../examples/canonical-v3-small.json', __dir__)), symbolize_names: true)
        path = File.join(Dir.mktmpdir('model-eval-json-writer'), 'fixture_model-eval.json')
        result = ModelEvalJSONWriter.write(path, graph)
        bytes = File.binread(path)
        payload = JSON.parse(bytes.force_encoding(Encoding::UTF_8), symbolize_names: true)

        assert(path.end_with?('_model-eval.json'), 'deterministic compact filename contract')
        assert(bytes.byteslice(0, 2) != "\x1f\x8b", 'plain JSON is not gzip')
        assert(!bytes.include?("\n"), 'output is minified')
        assert(payload.dig(:format, :identifier) == 'model_eval_json_v1', 'format identifier')
        assert(payload.dig(:format, :version) == '1.0.0', 'format version')
        assert(payload[:strings].uniq.length == payload[:strings].length, 'string table is deduplicated')
        assert(payload[:meshes][0][:positions].all? { |value| value.is_a?(Integer) }, 'quantized integer positions')
        assert(payload[:meshes][0].dig(:quantization, :measured_max_error_m) <= 0.001, 'quantization error bound')
        assert(payload[:meshes][0][:faces][0].length == 12, 'compact face row')
        assert(!payload.key?(:scenes) && !payload.key?(:analysis) && !payload.key?(:metadata), 'verbose optional payload omitted')
        validation = ModelEvalJSONWriter.validate(payload)
        assert(validation[:triangles] > 0, 'table references validate')
        assert(result[:bytes] == File.size(path), 'writer reports bytes')
        puts 'Model-Eval JSON Writer Tests: ALL PASSED'
      ensure
        FileUtils.remove_entry(File.dirname(path)) if path && Dir.exist?(File.dirname(path))
      end
    end
  end
end

BOMEngine::Tests::ModelEvalJSONWriterTest.run
