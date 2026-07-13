# Compact, plain-JSON runtime export for model-eval.

require 'digest'
require 'json'
require_relative 'quantizer'

module BOMEngine
  module ModelEvalJSONWriter
    FORMAT_NAME = 'BOM Engine Model-Eval JSON'.freeze
    FORMAT_VERSION = '1.0.0'.freeze
    FORMAT_IDENTIFIER = 'model_eval_json_v1'.freeze
    SCHEMA_URI = 'https://sibambo.dev/schemas/bom-engine/model-eval-json/1.0.0/schema.json'.freeze

    def self.build(graph)
      Builder.new(graph).build
    end

    def self.write(path, graph)
      payload = build(graph)
      validate(payload)
      content = JSON.generate(payload)
      File.open(path, 'w:UTF-8') { |file| file.write(content) }
      {
        path: path,
        bytes: File.size(path),
        sha256: Digest::SHA256.file(path).hexdigest,
        payload: payload,
        validation: validate(payload)
      }
    end

    # Structural validation intentionally mirrors the runtime loader's bounds
    # checks. JSON Schema validates shape; this validates table references.
    def self.validate(payload)
      raise 'Model-Eval JSON invalid: format.' unless payload.dig(:format, :identifier) == FORMAT_IDENTIFIER && payload.dig(:format, :version) == FORMAT_VERSION
      strings = payload[:strings]
      raise 'Model-Eval JSON invalid: string table.' unless strings.is_a?(Array) && strings.uniq.length == strings.length
      transforms = payload[:transforms]
      raise 'Model-Eval JSON invalid: transform table.' unless transforms.is_a?(Array) && (transforms.length % 16).zero?

      meshes = payload[:meshes] || []
      materials = payload[:materials] || []
      tags = payload[:tags] || []
      definitions = payload[:definitions] || []
      nodes = payload[:nodes] || []
      meshes.each_with_index do |mesh, mesh_index|
        values = mesh[:positions]
        loops = mesh[:loops]
        triangles = mesh[:triangles]
        vertex_count = mesh[:vertex_count].to_i
        raise "Model-Eval JSON invalid: mesh #{mesh_index} position count." unless values.is_a?(Array) && values.length == vertex_count * 3
        raise "Model-Eval JSON invalid: mesh #{mesh_index} loop index." if !loops.is_a?(Array) || loops.any? { |index| !index.is_a?(Integer) || index.negative? || index >= vertex_count }
        raise "Model-Eval JSON invalid: mesh #{mesh_index} triangle index." if !triangles.is_a?(Array) || (triangles.length % 3) != 0 || triangles.any? { |index| !index.is_a?(Integer) || index.negative? || index >= vertex_count }
        raise "Model-Eval JSON invalid: mesh #{mesh_index} triangle count." unless triangles.length / 3 == mesh[:triangle_count].to_i
        raise "Model-Eval JSON invalid: mesh #{mesh_index} definition." unless mesh[:definition].is_a?(Integer) && mesh[:definition].between?(0, definitions.length - 1)
        Array(mesh[:faces]).each do |face|
          raise "Model-Eval JSON invalid: mesh #{mesh_index} face row." unless face.is_a?(Array) && face.length == 12
          ranges = [[face[2], face[3]]] + Array(face[4])
          ranges.each do |range|
            raise "Model-Eval JSON invalid: mesh #{mesh_index} loop range." unless range.is_a?(Array) && range.length == 2 && range[0].is_a?(Integer) && range[1].is_a?(Integer) && range[0] >= 0 && range[1] >= 3 && range[0] + range[1] <= loops.length
          end
          raise "Model-Eval JSON invalid: mesh #{mesh_index} triangle range." unless face[5].is_a?(Integer) && face[6].is_a?(Integer) && face[5] >= 0 && face[6] >= 0 && (face[6] % 3).zero? && face[5] + face[6] <= triangles.length
          [face[7], face[8]].each { |index| raise "Model-Eval JSON invalid: mesh #{mesh_index} material." unless index.is_a?(Integer) && index >= -1 && index < materials.length }
          raise "Model-Eval JSON invalid: mesh #{mesh_index} tag." unless face[9].is_a?(Integer) && face[9] >= -1 && face[9] < tags.length
          [face[0], face[1], face[10]].each { |index| raise "Model-Eval JSON invalid: mesh #{mesh_index} string." unless index.is_a?(Integer) && index >= -1 && index < strings.length }
        end
      end
      definitions.each_with_index do |definition, index|
        raise "Model-Eval JSON invalid: definition #{index}." unless definition.is_a?(Array) && definition.length == 5
        raise "Model-Eval JSON invalid: definition #{index} mesh." unless definition[3].is_a?(Integer) && definition[3] >= -1 && definition[3] < meshes.length
        raise "Model-Eval JSON invalid: definition #{index} nodes." unless definition[4].is_a?(Array) && definition[4].all? { |node| node.is_a?(Integer) && node.between?(0, nodes.length - 1) }
      end
      nodes.each_with_index do |node, index|
        raise "Model-Eval JSON invalid: node #{index}." unless node.is_a?(Array) && node.length == 9
        raise "Model-Eval JSON invalid: node #{index} definition." unless node[3].is_a?(Integer) && node[3].between?(0, definitions.length - 1)
        raise "Model-Eval JSON invalid: node #{index} transform." unless node[4].is_a?(Integer) && node[4].between?(0, transforms.length / 16 - 1)
        material_ref, tag_ref = node[5], node[6]
        unless material_ref.is_a?(Integer) && material_ref >= -1 && material_ref < materials.length
          raise "Model-Eval JSON invalid: node #{index} material reference."
        end
        unless tag_ref.is_a?(Integer) && tag_ref >= -1 && tag_ref < tags.length
          raise "Model-Eval JSON invalid: node #{index} tag reference."
        end
      end
      raise 'Model-Eval JSON invalid: root node.' unless payload[:root_node].is_a?(Integer) && payload[:root_node].between?(0, nodes.length - 1)
      { meshes: meshes.length, definitions: definitions.length, nodes: nodes.length, triangles: meshes.sum { |mesh| mesh[:triangle_count].to_i }, quantization_max_error_m: meshes.map { |mesh| mesh.dig(:quantization, :measured_max_error_m).to_f }.max || 0.0 }
    end

    class StringTable
      attr_reader :values

      def initialize
        @values = []
        @index = {}
      end

      def intern(value)
        return -1 if value.nil?
        string = value.to_s
        return @index[string] if @index.key?(string)
        @index[string] = @values.length
        @values << string
        @index[string]
      end
    end

    class Builder
      def initialize(graph)
        @graph = graph
        @strings = StringTable.new
      end

      def build
        materials = Array(@graph[:materials])
        tags = Array(@graph[:tags])
        definitions = Array(@graph[:definitions])
        nodes = Array(@graph[:nodes])
        meshes = Array(@graph[:meshes])
        material_index = index_by_id(materials)
        tag_index = index_by_id(tags)
        definition_index = index_by_id(definitions)
        node_index = index_by_id(nodes)

        payload = {
          format: { name: FORMAT_NAME, version: FORMAT_VERSION, identifier: FORMAT_IDENTIFIER, schema: SCHEMA_URI },
          units: 'm',
          coordinate_system: @graph[:coordinate_system],
          source: compact_source(@graph[:source] || {}),
          strings: nil,
          materials: materials.map { |material| compact_material(material) },
          tags: tags.map { |tag| [@strings.intern(tag[:id]), @strings.intern(tag[:name]), tag[:visible] != false] },
          transforms: Array(@graph[:transforms]).flatten.map(&:to_f),
          meshes: meshes.map { |mesh| compact_mesh(mesh, definition_index, material_index, tag_index) },
          definitions: definitions.map { |definition| compact_definition(definition, node_index, meshes) },
          nodes: nodes.map { |node| compact_node(node, definition_index, material_index, tag_index) },
          root_node: nodes.index { |node| node[:kind] == 'root' },
          statistics: nil
        }
        payload[:strings] = @strings.values
        payload[:statistics] = {
          unique_meshes: payload[:meshes].length,
          definitions: payload[:definitions].length,
          nodes: payload[:nodes].length,
          component_instances: nodes.count { |node| node[:kind] == 'component_instance' },
          group_instances: nodes.count { |node| node[:kind] == 'group_instance' },
          unique_vertices: payload[:meshes].sum { |mesh| mesh[:vertex_count] },
          triangles: payload[:meshes].sum { |mesh| mesh[:triangle_count] }
        }
        payload
      end

      private

      def compact_source(source)
        [@strings.intern(source[:file_name]), @strings.intern(source[:model_name]), @strings.intern(source[:scope]), @strings.intern(source[:exported_at])]
      end

      def compact_material(material)
        color = material[:color] || {}
        [@strings.intern(material[:id]), @strings.intern(material[:name]), @strings.intern(color[:hex]), material[:opacity].to_f]
      end

      def compact_mesh(mesh, definition_index, material_index, tag_index)
        quantized = Quantizer.quantize_positions(mesh[:positions_m])
        loops = []
        triangles = []
        faces = Array(mesh[:faces]).map do |face|
          outer_start = loops.length
          loops.concat(face[:outer])
          holes = Array(face[:holes]).map do |hole|
            start = loops.length
            loops.concat(hole)
            [start, hole.length]
          end
          triangle_start = triangles.length
          face_triangles = Array(face[:triangles])
          triangles.concat(face_triangles)
          [
            @strings.intern(face[:id]),
            @strings.intern(face.dig(:source_identity, :persistent_id)),
            outer_start,
            Array(face[:outer]).length,
            holes,
            triangle_start,
            face_triangles.length,
            value_index(material_index, face[:front_material_id]),
            value_index(material_index, face[:back_material_id]),
            value_index(tag_index, face[:tag_id]),
            @strings.intern(face[:surface_hint]),
            face[:area_m2].to_f
          ]
        end
        {
          id: @strings.intern(mesh[:id]),
          definition: definition_index.fetch(mesh[:definition_id]),
          vertex_count: Array(mesh[:positions_m]).length / 3,
          triangle_count: triangles.length / 3,
          quantization: quantized.reject { |key, _| key == :values },
          positions: quantized[:values],
          loops: loops,
          triangles: triangles,
          faces: faces
        }
      end

      def compact_definition(definition, node_index, meshes)
        mesh_index = meshes.index { |mesh| mesh[:id] == definition[:mesh_id] }
        [
          @strings.intern(definition[:id]),
          @strings.intern(definition[:name]),
          @strings.intern(definition[:kind]),
          mesh_index || -1,
          Array(definition[:node_ids]).map { |id| node_index.fetch(id) }
        ]
      end

      def compact_node(node, definition_index, material_index, tag_index)
        [
          @strings.intern(node[:id]),
          @strings.intern(node[:name]),
          node_kind(node[:kind]),
          definition_index.fetch(node[:definition_id]),
          node[:transform_id].to_i,
          value_index(material_index, node[:material_override_id]),
          value_index(tag_index, node[:tag_id]),
          node[:visible] != false,
          @strings.intern(node.dig(:source_identity, :persistent_id))
        ]
      end

      def node_kind(kind)
        { 'root' => 1, 'component_instance' => 2, 'group_instance' => 3, 'image' => 4, 'text' => 5 }.fetch(kind, 0)
      end

      def index_by_id(items)
        items.each_with_index.to_h { |item, index| [item[:id], index] }
      end

      def value_index(index, value)
        value.nil? ? -1 : index.fetch(value, -1)
      end
    end
  end
end
