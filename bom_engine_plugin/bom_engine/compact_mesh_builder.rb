# bom_engine/compact_mesh_builder.rb
# Builds a flat-array geometry payload for fast transfer and browser parsing.

module BOMEngine
  module CompactMeshBuilder
    POSITION_SCALE = 0.001
    AREA_SCALE     = 0.0001
    NORMAL_SCALE   = 0.0001
    FACE_STRIDE    = 9

    def self.build(entities, parent_tf, opts = {})
      builder = Builder.new(opts)
      builder.walk(entities, parent_tf, 0, opts[:inherited_material])
      builder.result
    end

    class Builder
      def initialize(opts = {})
        @surfaces = []
        @surface_index = {}
        @layers = []
        @layer_index = {}
        @materials = []
        @material_index = {}
        @positions = []
        @faces = []
        @stats = { faces: 0, roof_slope_faces: 0, vertices: 0 }
      end

    def walk(entities, parent_tf, depth = 0, inherited_material = nil)
      return if depth > Constants::MAX_RECURSION_DEPTH

      entities.each do |entity|
        next unless Traversal.exportable_entity?(entity)

        case entity
        when Sketchup::Face
          append_face(entity, parent_tf, inherited_material)
        when Sketchup::Group
          child_material = entity_material(entity) || inherited_material
          walk(entity.entities, parent_tf * entity.transformation, depth + 1, child_material)
        when Sketchup::ComponentInstance
          child_material = entity_material(entity) || inherited_material
          walk(entity.definition.entities, parent_tf * entity.transformation, depth + 1, child_material)
        end
      end
    end

    def result
      {
        mesh: {
          version: 1,
          position_scale: POSITION_SCALE,
          area_scale: AREA_SCALE,
          normal_scale: NORMAL_SCALE,
          face_stride: FACE_STRIDE,
          face_fields: %w[vertex_start vertex_count surface material layer area normal_x normal_y normal_z],
          surfaces: @surfaces,
          layers: @layers,
          materials: @materials,
          positions: @positions,
          faces: @faces
        },
        stats: @stats
      }
    end

    private

    def append_face(face, tf, inherited_material)
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

        vertex_start = @positions.length / 3
        world_points.each { |point| append_point(point) }

        @faces.concat([
          vertex_start,
          world_points.length,
          surface_idx,
          material_idx,
          layer_idx,
          quantize(area_m2, AREA_SCALE),
          quantize(normal_world.x, NORMAL_SCALE),
          quantize(normal_world.y, NORMAL_SCALE),
          quantize(normal_world.z, NORMAL_SCALE)
        ])

        @stats[:faces] += 1
        @stats[:vertices] += world_points.length
        @stats[:roof_slope_faces] += 1 if surface_type == "roof_slope"
      end
    end

    def append_point(point)
      @positions << quantize(point.x * Constants::IN_TO_M, POSITION_SCALE)
      @positions << quantize(point.y * Constants::IN_TO_M, POSITION_SCALE)
      @positions << quantize(point.z * Constants::IN_TO_M, POSITION_SCALE)
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
