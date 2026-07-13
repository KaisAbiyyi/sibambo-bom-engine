# tests/test_canonical_graph.rb
# Run in SketchUp Ruby Console:
#   load 'D:/projects/sibambo-bom-engine/bom_engine_plugin/bom_engine/tests/test_canonical_graph.rb'

require_relative '../constants'
require_relative '../traversal'
require_relative '../canonical_graph_builder'

module BOMEngine
  module Tests
    module CanonicalGraphTest
      module_function

      def run
        puts "\n=== BOM Engine: Canonical Graph Tests ==="
        model = Sketchup.active_model
        raise 'No active SketchUp model' unless model

        failures = []
        model.start_operation('BOM Engine Canonical Graph Test', true)
        begin
          root = model.entities.add_group
          root.name = "BOM v3 Test Root #{Time.now.to_f}"

          material = model.materials.add("BOM v3 Test Material #{Time.now.to_f}")
          material.color = Sketchup::Color.new(12, 34, 56)

          definition = model.definitions.add("BOM v3 Reused Definition #{Time.now.to_f}")
          outer = definition.entities.add_face(
            [0, 0, 0],
            [4, 0, 0],
            [4, 4, 0],
            [0, 4, 0]
          )
          outer.material = material
          inner = definition.entities.add_face(
            [1, 1, 0],
            [1, 3, 0],
            [3, 3, 0],
            [3, 1, 0]
          )
          inner.erase! if inner && !inner.deleted?

          first_instance = root.entities.add_instance(
            definition,
            Geom::Transformation.translation([10, 0, 0])
          )
          first_instance.name = 'First Reused Instance'
          second_instance = root.entities.add_instance(
            definition,
            Geom::Transformation.translation([20, 0, 0])
          )
          second_instance.name = 'Second Reused Instance'

          nested_group = root.entities.add_group
          nested_group.name = 'Nested Group'
          nested_group.entities.add_face(
            [0, 0, 0],
            [2, 0, 0],
            [2, 2, 0],
            [0, 2, 0]
          )

          graph = CanonicalGraphBuilder.build(
            model: model,
            entities: root.entities,
            parent_transform: Geom::Transformation.new,
            settings: { include_edges: false, selection_only: true },
            spatial: {}
          )

          check(failures, 'format version is 3.0.0') do
            graph.dig(:format, :version) == '3.0.0'
          end

          reused_definition = graph[:definitions].find do |item|
            item.dig(:source_identity, :guid) == definition.guid
          end
          check(failures, 'reused component definition emitted once') do
            !reused_definition.nil? &&
              graph[:definitions].count { |item| item[:id] == reused_definition[:id] } == 1
          end

          reused_nodes = graph[:nodes].select do |node|
            node[:kind] == 'component_instance' && node[:definition_id] == reused_definition[:id]
          end
          check(failures, 'two instances reference one definition') do
            reused_nodes.length == 2 && reused_nodes.map { |node| node[:transform_id] }.uniq.length == 2
          end

          mesh = graph[:meshes].find { |item| item[:id] == reused_definition[:mesh_id] }
          check(failures, 'definition uses local indexed geometry') do
            mesh && mesh[:positions_m].length == 24 && mesh[:faces].length == 1 &&
              mesh[:faces][0][:outer].length == 4 && mesh[:faces][0][:holes].length == 1
          end

          check(failures, 'face includes SketchUp-derived indexed triangles') do
            mesh[:faces][0][:triangles].is_a?(Array) &&
              mesh[:faces][0][:triangles].length >= 6 &&
              (mesh[:faces][0][:triangles].length % 3).zero? &&
              mesh[:faces][0][:triangles].all? { |index| index >= 0 && index < mesh[:positions_m].length / 3 }
          end

          check(failures, 'local geometry is not expanded into world space') do
            mesh[:positions_m].each_slice(3).map(&:first).max <= (4.0 * Constants::IN_TO_M + 0.000001)
          end

          check(failures, 'instance translation is converted from inches to meters') do
            matrices = reused_nodes.map { |node| graph[:transforms][node[:transform_id]][12] }.sort
            matrices == [0.254, 0.508]
          end

          face = mesh[:faces][0]
          check(failures, 'face keeps source identity, material, tag, normal, and area') do
            face.dig(:source_identity, :persistent_id) == outer.persistent_id.to_s &&
              !face[:front_material_id].nil? && !face[:tag_id].nil? &&
              face[:normal].is_a?(Array) && face[:normal].length == 3 && face[:area_m2].positive?
          end

          check(failures, 'group has separate definition and instance node') do
            graph[:nodes].any? { |node| node[:kind] == 'group_instance' && node[:name] == 'Nested Group' }
          end
        ensure
          model.abort_operation
        end

        if failures.empty?
          puts 'Canonical Graph Tests: ALL PASSED'
          true
        else
          puts "Canonical Graph Tests: #{failures.length} FAILED"
          failures.each { |failure| puts "  FAIL #{failure}" }
          raise "Canonical Graph Tests failed: #{failures.join('; ')}"
        end
      end

      def check(failures, name)
        passed = yield
        puts "  #{passed ? 'PASS' : 'FAIL'} #{name}"
        failures << name unless passed
      rescue StandardError => error
        puts "  FAIL #{name}: #{error.class}: #{error.message}"
        failures << "#{name} (#{error.class})"
      end
    end
  end
end

BOMEngine::Tests::CanonicalGraphTest.run
