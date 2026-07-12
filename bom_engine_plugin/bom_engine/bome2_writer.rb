# BOME2 sectioned, checksummed runtime container derived from canonical JSON v3.

require 'digest'
require 'json'
require 'zlib'
require_relative 'quantizer'

module BOMEngine
  module BOME2Writer
    MAGIC = "BOME2\n".b
    VERSION = '2.0.0'.freeze
    FIXED_HEADER_BYTES = 24
    DIRECTORY_ENTRY_BYTES = 32
    GLOBAL_SECTION = 0xffff_ffff
    FLAG_LITTLE_ENDIAN = 1

    SECTION_KIND = { positions: 1, loops: 2, triangles: 3, transforms: 4 }.freeze
    COMPONENT_TYPE = { uint16: 1, uint32: 2, float32: 3 }.freeze
    COMPONENT_BYTES = { 1 => 2, 2 => 4, 3 => 4 }.freeze
    NODE_KIND = { 'root' => 1, 'component_instance' => 2, 'group_instance' => 3, 'image' => 4, 'text' => 5 }.freeze

    def self.pack(graph)
      manifest, sections = Builder.new(graph).build
      pack_container(manifest, sections)
    end

    def self.write(path, graph, compress:)
      bytes = pack(graph)
      if compress
        Zlib::GzipWriter.open(path) do |gzip|
          gzip.mtime = 0
          gzip.write(bytes)
        end
      else
        File.open(path, 'wb') { |file| file.write(bytes) }
      end
      {
        path: path,
        compressed: compress,
        bytes: File.size(path),
        uncompressed_bytes: bytes.bytesize,
        sha256: Digest::SHA256.file(path).hexdigest
      }
    end

    def self.pack_container(manifest, sections)
      manifest_json = JSON.generate(manifest)
      padding = (4 - ((MAGIC.bytesize + FIXED_HEADER_BYTES + manifest_json.bytesize) % 4)) % 4
      manifest_bytes = (manifest_json + (' ' * padding)).b
      directory_bytes = sections.length * DIRECTORY_ENTRY_BYTES
      data_offset = MAGIC.bytesize + FIXED_HEADER_BYTES + manifest_bytes.bytesize + directory_bytes
      cursor = data_offset
      directory = +''.b
      body = +''.b

      sections.each do |section|
        section_padding = (4 - (cursor % 4)) % 4
        body << ("\0" * section_padding)
        cursor += section_padding
        section[:offset] = cursor
        section[:crc32] = Zlib.crc32(section[:bytes])
        directory << [
          SECTION_KIND.fetch(section[:kind]),
          section.fetch(:mesh_index, GLOBAL_SECTION),
          cursor,
          section[:bytes].bytesize,
          section[:count],
          COMPONENT_TYPE.fetch(section[:component_type]),
          section[:crc32],
          0
        ].pack('V8')
        body << section[:bytes]
        cursor += section[:bytes].bytesize
      end

      fixed = [
        manifest_bytes.bytesize,
        directory_bytes,
        sections.length,
        Zlib.crc32(manifest_json.b),
        FLAG_LITTLE_ENDIAN,
        0
      ].pack('V6')
      MAGIC + fixed + manifest_bytes + directory + body
    end
    private_class_method :pack_container

    def self.read_manifest(bytes)
      bytes = bytes.b
      raise 'BOME2 invalid: magic mismatch.' unless bytes.start_with?(MAGIC)
      raise 'BOME2 invalid: truncated fixed header.' if bytes.bytesize < MAGIC.bytesize + FIXED_HEADER_BYTES

      fixed_offset = MAGIC.bytesize
      header_bytes, directory_bytes, section_count, manifest_crc32, flags, = bytes[fixed_offset, FIXED_HEADER_BYTES].unpack('V6')
      raise 'BOME2 invalid: unsupported byte order.' unless (flags & FLAG_LITTLE_ENDIAN) == FLAG_LITTLE_ENDIAN
      raise 'BOME2 invalid: directory byte count mismatch.' unless directory_bytes == section_count * DIRECTORY_ENTRY_BYTES

      manifest_offset = MAGIC.bytesize + FIXED_HEADER_BYTES
      directory_offset = manifest_offset + header_bytes
      data_offset = directory_offset + directory_bytes
      raise 'BOME2 invalid: header or directory outside file.' if data_offset > bytes.bytesize

      manifest_raw = bytes[manifest_offset, header_bytes].b
      manifest_json = manifest_raw.sub(/ +\z/n, '')
      raise 'BOME2 invalid: manifest checksum mismatch.' unless Zlib.crc32(manifest_json) == manifest_crc32
      manifest = JSON.parse(manifest_json.dup.force_encoding(Encoding::UTF_8), symbolize_names: true)
      unless manifest.dig(:format, :name) == 'BOME2' && manifest.dig(:format, :version) == VERSION
        raise 'BOME2 invalid: format version mismatch.'
      end

      sections = section_count.times.map do |index|
        offset = directory_offset + index * DIRECTORY_ENTRY_BYTES
        kind, mesh_index, section_offset, byte_length, count, component_type, crc32, = bytes[offset, DIRECTORY_ENTRY_BYTES].unpack('V8')
        component_bytes = COMPONENT_BYTES[component_type]
        raise "BOME2 invalid: section #{index} component type." if component_bytes.nil?
        raise "BOME2 invalid: section #{index} byte count mismatch." unless byte_length == count * component_bytes
        if section_offset < data_offset || section_offset + byte_length > bytes.bytesize
          raise "BOME2 invalid: section #{index} bounds outside file."
        end
        {
          index: index,
          kind: kind,
          mesh_index: mesh_index,
          offset: section_offset,
          byte_length: byte_length,
          count: count,
          component_type: component_type,
          crc32: crc32
        }
      end
      sections.sort_by { |section| section[:offset] }.each_cons(2) do |left, right|
        raise 'BOME2 invalid: overlapping sections.' if left[:offset] + left[:byte_length] > right[:offset]
      end

      { manifest: manifest, sections: sections, header_bytes: header_bytes, data_offset: data_offset }
    rescue JSON::ParserError => error
      raise "BOME2 invalid: manifest JSON #{error.message}"
    end

    def self.validate(bytes)
      bytes = bytes.b
      decoded = read_manifest(bytes)
      decoded[:sections].each do |section|
        content = bytes[section[:offset], section[:byte_length]]
        unless Zlib.crc32(content) == section[:crc32]
          raise "BOME2 invalid: section #{section[:index]} checksum mismatch."
        end
      end
      validate_manifest(decoded[:manifest], decoded[:sections], bytes)
    end

    def self.validate_manifest(manifest, sections, bytes)
      strings = manifest[:strings]
      raise 'BOME2 invalid: missing string table.' unless strings.is_a?(Array) && strings.uniq.length == strings.length
      meshes = manifest[:meshes] || []
      definitions = manifest[:definitions] || []
      nodes = manifest[:nodes] || []
      transforms = manifest[:transforms] || {}
      transform_section = sections[transforms[:section].to_i]
      unless transform_section && transform_section[:kind] == SECTION_KIND[:transforms] && transform_section[:count] == transforms[:count].to_i * 16
        raise 'BOME2 invalid: transform section mismatch.'
      end

      triangle_count = 0
      meshes.each_with_index do |mesh, mesh_index|
        position_section = section_for(sections, mesh[:positions_section], SECTION_KIND[:positions], mesh_index)
        loop_section = section_for(sections, mesh[:loops_section], SECTION_KIND[:loops], mesh_index)
        triangle_section = section_for(sections, mesh[:triangles_section], SECTION_KIND[:triangles], mesh_index)
        unless position_section[:count] == mesh[:vertex_count].to_i * 3
          raise "BOME2 invalid: mesh #{mesh_index} vertex count mismatch."
        end
        vertex_count = mesh[:vertex_count].to_i
        loop_indices = unpack_unsigned(bytes[loop_section[:offset], loop_section[:byte_length]], loop_section[:component_type])
        triangles = unpack_unsigned(bytes[triangle_section[:offset], triangle_section[:byte_length]], triangle_section[:component_type])
        raise "BOME2 invalid: mesh #{mesh_index} loop index outside vertex buffer." if loop_indices.any? { |index| index >= vertex_count }
        raise "BOME2 invalid: mesh #{mesh_index} triangle index outside vertex buffer." if triangles.any? { |index| index >= vertex_count }
        raise "BOME2 invalid: mesh #{mesh_index} triangle count." unless (triangles.length % 3).zero?
        mesh[:faces].each do |face|
          ranges = [[face[:outer_start], face[:outer_count]]] + Array(face[:holes]).map { |range| [range[0], range[1]] }
          ranges.each do |start, count|
            if start.to_i < 0 || count.to_i < 3 || start.to_i + count.to_i > loop_indices.length
              raise 'BOME2 invalid: face loop range.'
            end
          end
          start = face[:triangle_start].to_i
          count = face[:triangle_count].to_i
          if start < 0 || count < 0 || start + count > triangles.length || (count % 3) != 0
            raise 'BOME2 invalid: face triangle range.'
          end
        end
        triangle_count += triangles.length / 3
      end

      raise 'BOME2 invalid: exactly one root node required.' unless nodes.count { |node| node[:kind] == NODE_KIND['root'] } == 1
      nodes.each do |node|
        definition = node[:definition].to_i
        transform = node[:transform].to_i
        raise 'BOME2 invalid: node definition reference.' if definition < 0 || definition >= definitions.length
        raise 'BOME2 invalid: node transform reference.' if transform < 0 || transform >= transforms[:count].to_i
      end

      {
        format: VERSION,
        meshes: meshes.length,
        definitions: definitions.length,
        nodes: nodes.length,
        instances: nodes.count { |node| node[:kind] == NODE_KIND['component_instance'] },
        triangles: triangle_count,
        sections: sections.length,
        quantization_max_error_m: meshes.map { |mesh| mesh.dig(:quantization, :measured_max_error_m).to_f }.max || 0.0
      }
    end
    private_class_method :validate_manifest

    def self.section_for(sections, index, kind, mesh_index)
      section = sections[index.to_i]
      unless section && section[:kind] == kind && section[:mesh_index] == mesh_index
        raise "BOME2 invalid: mesh #{mesh_index} section reference."
      end
      section
    end
    private_class_method :section_for

    def self.unpack_unsigned(bytes, component_type)
      component_type == COMPONENT_TYPE[:uint16] ? bytes.unpack('S<*') : bytes.unpack('V*')
    end
    private_class_method :unpack_unsigned

    class StringTable
      attr_reader :values

      def initialize
        @values = []
        @index = {}
      end

      def intern(value)
        return -1 if value.nil?
        string = value.to_s
        existing = @index[string]
        return existing unless existing.nil?
        index = @values.length
        @values << string
        @index[string] = index
        index
      end
    end

    class Builder
      def initialize(graph)
        @graph = graph
        @strings = StringTable.new
        @sections = []
      end

      def build
        material_index = index_by_id(@graph[:materials])
        tag_index = index_by_id(@graph[:tags])
        definition_index = index_by_id(@graph[:definitions])
        node_index = index_by_id(@graph[:nodes])
        mesh_index = index_by_id(@graph[:meshes])

        transform_section = add_section(
          kind: :transforms,
          mesh_index: GLOBAL_SECTION,
          component_type: :float32,
          count: @graph[:transforms].length * 16,
          bytes: @graph[:transforms].flatten.map(&:to_f).pack('e*')
        )
        meshes = @graph[:meshes].each_with_index.map do |mesh, index|
          build_mesh(mesh, index, definition_index, material_index, tag_index)
        end
        materials = @graph[:materials].map { |material| build_material(material) }
        tags = @graph[:tags].map { |tag| build_tag(tag) }
        definitions = @graph[:definitions].map do |definition|
          {
            id: @strings.intern(definition[:id]),
            name: @strings.intern(definition[:name]),
            kind: @strings.intern(definition[:kind]),
            mesh: value_index(mesh_index, definition[:mesh_id]),
            nodes: Array(definition[:node_ids]).map { |id| node_index.fetch(id) }
          }
        end
        nodes = @graph[:nodes].map do |node|
          {
            id: @strings.intern(node[:id]),
            name: @strings.intern(node[:name]),
            kind: NODE_KIND.fetch(node[:kind], 0),
            owner_definition: value_index(definition_index, node[:owner_definition_id]),
            definition: definition_index.fetch(node[:definition_id]),
            transform: node[:transform_id],
            material: value_index(material_index, node[:material_override_id]),
            tag: value_index(tag_index, node[:tag_id]),
            visible: node[:visible] != false,
            source_persistent_id: @strings.intern(node.dig(:source_identity, :persistent_id))
          }
        end
        source = @graph[:source] || {}
        manifest = {
          format: {
            name: 'BOME2',
            version: VERSION,
            canonical_version: @graph.dig(:format, :version).to_s,
            layout: 'section_directory_v1'
          },
          source: {
            file_name: @strings.intern(source[:file_name]),
            model_name: @strings.intern(source[:model_name]),
            scope: @strings.intern(source[:scope]),
            exported_at: @strings.intern(source[:exported_at])
          },
          coordinate_system: @graph[:coordinate_system],
          strings: nil,
          materials: materials,
          tags: tags,
          transforms: { section: transform_section, count: @graph[:transforms].length, component_type: 'float32' },
          meshes: meshes,
          definitions: definitions,
          nodes: nodes,
          root_node: nodes.index { |node| node[:kind] == NODE_KIND['root'] },
          statistics: {
            unique_meshes: meshes.length,
            definitions: definitions.length,
            nodes: nodes.length,
            component_instances: nodes.count { |node| node[:kind] == NODE_KIND['component_instance'] },
            group_instances: nodes.count { |node| node[:kind] == NODE_KIND['group_instance'] },
            unique_vertices: meshes.sum { |mesh| mesh[:vertex_count] },
            triangles: meshes.sum { |mesh| mesh[:triangle_count] },
            sections: @sections.length
          }
        }
        manifest[:strings] = @strings.values
        [manifest, @sections]
      end

      private

      def build_mesh(mesh, mesh_index, definition_index, material_index, tag_index)
        quantized = Quantizer.quantize_positions(mesh[:positions_m])
        position_section = add_section(
          kind: :positions,
          mesh_index: mesh_index,
          component_type: quantized[:component_type].to_sym,
          count: quantized[:values].length,
          bytes: Quantizer.pack_values(quantized)
        )
        loops = []
        triangles = []
        faces = mesh[:faces].map do |face|
          outer_start = loops.length
          loops.concat(face[:outer])
          hole_ranges = face[:holes].map do |hole|
            start = loops.length
            loops.concat(hole)
            [start, hole.length]
          end
          triangle_start = triangles.length
          face_triangles = Array(face[:triangles])
          triangles.concat(face_triangles)
          {
            id: @strings.intern(face[:id]),
            source_persistent_id: @strings.intern(face.dig(:source_identity, :persistent_id)),
            outer_start: outer_start,
            outer_count: face[:outer].length,
            holes: hole_ranges,
            triangle_start: triangle_start,
            triangle_count: face_triangles.length,
            material: value_index(material_index, face[:front_material_id]),
            back_material: value_index(material_index, face[:back_material_id]),
            tag: value_index(tag_index, face[:tag_id]),
            surface_hint: @strings.intern(face[:surface_hint]),
            area_m2: face[:area_m2]
          }
        end
        loop_section = add_section(kind: :loops, mesh_index: mesh_index, component_type: :uint32, count: loops.length, bytes: loops.pack('V*'))
        triangle_section = add_section(kind: :triangles, mesh_index: mesh_index, component_type: :uint32, count: triangles.length, bytes: triangles.pack('V*'))
        {
          id: @strings.intern(mesh[:id]),
          definition: definition_index.fetch(mesh[:definition_id]),
          positions_section: position_section,
          loops_section: loop_section,
          triangles_section: triangle_section,
          vertex_count: mesh[:positions_m].length / 3,
          triangle_count: triangles.length / 3,
          quantization: quantized.reject { |key, _| key == :values },
          faces: faces
        }
      end

      def build_material(material)
        color = material[:color] || {}
        texture = material[:texture]
        {
          id: @strings.intern(material[:id]),
          name: @strings.intern(material[:name]),
          display_name: @strings.intern(material[:display_name]),
          color_rgba: [color[:r] || 0, color[:g] || 0, color[:b] || 0, color[:a] || 255],
          color_hex: @strings.intern(color[:hex]),
          opacity: material[:opacity],
          texture: texture ? @strings.intern(texture[:filename]) : -1
        }
      end

      def build_tag(tag)
        { id: @strings.intern(tag[:id]), name: @strings.intern(tag[:name]), visible: tag[:visible] != false }
      end

      def add_section(section)
        index = @sections.length
        @sections << section
        index
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
