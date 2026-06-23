# bom_engine/binary_mesh_streamer.rb
# Two-pass binary exporter. Pass 1 collects counts and dictionaries for header.
# Pass 2 streams int32 geometry directly to .bome/.bome.gz without storing arrays.

module BOMEngine
  module BinaryMeshStreamer
    POSITION_SCALE = CompactMeshBuilder::POSITION_SCALE
    AREA_SCALE     = CompactMeshBuilder::AREA_SCALE
    NORMAL_SCALE   = CompactMeshBuilder::NORMAL_SCALE
    FACE_STRIDE    = CompactMeshBuilder::FACE_STRIDE

    def self.export(out_path:, model:, entities:, parent_tf:, settings:, materials:, spatial:, compress:)
      streamer = Streamer.new
      streamer.scan(entities, parent_tf, 0, settings[:inherited_material])
      payload = JSONBuilder.build(
        model: model,
        entities: [],
        materials: materials,
        spatial: spatial,
        settings: settings,
        compact_mesh: streamer.mesh_header
      )
      if compress
        Zlib::GzipWriter.open(out_path) { |gzip| streamer.write(gzip, payload, entities, parent_tf, settings[:inherited_material]) }
      else
        File.open(out_path, "wb") { |file| streamer.write(file, payload, entities, parent_tf, settings[:inherited_material]) }
      end
      streamer.stats
    end

    class Streamer
      attr_reader :stats

      def initialize
        @surfaces = []
        @surface_index = {}
        @layers = []
        @layer_index = {}
        @materials = []
        @material_index = {}
        @position_count = 0
        @face_int_count = 0
        @write_vertex_start = 0
        @stats = { faces: 0, roof_slope_faces: 0, vertices: 0 }
      end

      def mesh_header
        {
          version: 1,
          position_scale: POSITION_SCALE,
          area_scale: AREA_SCALE,
          normal_scale: NORMAL_SCALE,
          face_stride: FACE_STRIDE,
          face_fields: %w[vertex_start vertex_count surface material layer area normal_x normal_y normal_z],
          surfaces: @surfaces,
          layers: @layers,
          materials: @materials,
          positions: [],
          faces: []
        }
      end

      def scan(entities, parent_tf, depth = 0, inherited_material = nil)
        each_polygon(entities, parent_tf, depth, inherited_material) do |polygon|
          @position_count += polygon[:points].length
          @face_int_count += FACE_STRIDE
          @stats[:faces] += 1
          @stats[:vertices] += polygon[:points].length
          @stats[:roof_slope_faces] += 1 if polygon[:surface_type] == "roof_slope"
        end
      end

      def write(io, payload, entities, parent_tf, inherited_material = nil)
        BinaryMeshWriter.write_header(io, payload, position_count: @position_count * 3, face_int_count: @face_int_count)
        each_polygon(entities, parent_tf, 0, inherited_material) do |polygon|
          write_points(io, polygon[:points])
        end

        @write_vertex_start = 0
        each_polygon(entities, parent_tf, 0, inherited_material) do |polygon|
          io.write([
            @write_vertex_start,
            polygon[:points].length,
            polygon[:surface_idx],
            polygon[:material_idx],
            polygon[:layer_idx],
            quantize(polygon[:area_m2], AREA_SCALE),
            quantize(polygon[:normal].x, NORMAL_SCALE),
            quantize(polygon[:normal].y, NORMAL_SCALE),
            quantize(polygon[:normal].z, NORMAL_SCALE)
          ].pack("l<*"))
          @write_vertex_start += polygon[:points].length
        end
      end

      private

      def each_polygon(entities, parent_tf, depth = 0, inherited_material = nil, &block)
        return if depth > Constants::MAX_RECURSION_DEPTH

        entities.each do |entity|
          next unless Traversal.exportable_entity?(entity)

          case entity
          when Sketchup::Face
            each_face_polygon(entity, parent_tf, inherited_material, &block)
          when Sketchup::Group
            child_material = entity_material(entity) || inherited_material
            each_polygon(entity.entities, parent_tf * entity.transformation, depth + 1, child_material, &block)
          when Sketchup::ComponentInstance
            child_material = entity_material(entity) || inherited_material
            each_polygon(entity.definition.entities, parent_tf * entity.transformation, depth + 1, child_material, &block)
          end
        end
      end

      def each_face_polygon(face, tf, inherited_material)
        mesh = begin
          face.mesh
        rescue
          nil
        end
        return unless mesh && mesh.respond_to?(:polygons)

        normal_world = Traversal.world_normal(face, tf)
        surface_type = Classifier.classify(normal_world)
        front_mat = face.material || inherited_material
        back_mat = face.back_material || inherited_material
        color_mat = front_mat || back_mat
        material_idx = intern_material(color_mat)
        layer_idx = intern(@layer_index, @layers, Traversal.safe_layer_name(face))
        surface_idx = intern(@surface_index, @surfaces, surface_type)

        mesh.polygons.each do |polygon|
          local_points = polygon.map { |point_index| mesh.point_at(point_index.abs) }.compact
          next if local_points.length < 3

          world_points = local_points.map { |point| tf * point }
          area_m2 = Traversal.polygon_area_m2(world_points)
          next if area_m2 <= 0

          yield({
            points: world_points,
            area_m2: area_m2,
            normal: normal_world,
            surface_type: surface_type,
            surface_idx: surface_idx,
            material_idx: material_idx,
            layer_idx: layer_idx
          })
        end
      end

      def write_points(io, points)
        io.write(points.flat_map { |point|
          [
            quantize(point.x * Constants::IN_TO_M, POSITION_SCALE),
            quantize(point.y * Constants::IN_TO_M, POSITION_SCALE),
            quantize(point.z * Constants::IN_TO_M, POSITION_SCALE)
          ]
        }.pack("l<*"))
      end

      def intern(index, values, value)
        key = value.to_s
        existing = index[key]
        return existing unless existing.nil?

        id = values.length
        index[key] = id
        values << key
        id
      end

      def intern_material(mat)
        return -1 if mat.nil?

        color = Traversal.material_color(mat)
        texture = mat.texture rescue nil
        texture_name = texture ? texture.filename.to_s : ""
        key = "#{mat.name}|#{color}|#{texture_name}"
        existing = @material_index[key]
        return existing unless existing.nil?

        id = @materials.length
        @material_index[key] = id
        item = {
          name: mat.name,
          display_name: mat.display_name,
          color: { hex: color }
        }
        if texture
          item[:texture] = {
            filename: texture.filename,
            width_m: quantize(texture.width * Constants::IN_TO_M, POSITION_SCALE) * POSITION_SCALE,
            height_m: quantize(texture.height * Constants::IN_TO_M, POSITION_SCALE) * POSITION_SCALE,
            image_width_px: texture.image_width,
            image_height_px: texture.image_height
          }
        end
        @materials << item
        id
      end

      def entity_material(entity)
        entity.respond_to?(:material) ? entity.material : nil
      rescue
        nil
      end

      def quantize(value, scale)
        (value.to_f / scale).round
      end
    end
  end
end
