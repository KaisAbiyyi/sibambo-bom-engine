# bom_engine/canonical_graph_builder.rb
# Builds the semantic, definition-local graph used by canonical JSON v3 and BOME2.

require 'time'

module BOMEngine
  module CanonicalGraphBuilder
    FORMAT_NAME = 'BOM Engine Canonical'.freeze
    FORMAT_VERSION = '3.0.0'.freeze
    SCHEMA_URI = 'https://sibambo.dev/schemas/bom-engine/3.0.0/schema.json'.freeze

    def self.build(model:, entities:, parent_transform:, settings:, spatial:, texture_writer: nil)
      Builder.new(
        model: model,
        settings: settings,
        spatial: spatial,
        texture_writer: texture_writer
      ).build(entities, parent_transform)
    end

    class Builder
      def initialize(model:, settings:, spatial:, texture_writer:)
        @model = model
        @settings = settings || {}
        @spatial = spatial || {}
        @texture_writer = texture_writer
        @definitions = []
        @definition_index = {}
        @meshes = []
        @nodes = []
        @transforms = []
        @transform_index = {}
        @materials = []
        @material_ids = {}
        @tags = []
        @tag_ids = {}
        @skipped = Hash.new(0)
      end

      def build(entities, parent_transform)
        build_tags
        build_materials
        identity_transform_id = intern_transform(Geom::Transformation.new)
        root_definition_id = root_definition_id()
        root_definition = build_definition(
          id: root_definition_id,
          name: @settings[:selection_only] ? 'Selection Root' : 'Model Root',
          entities: entities,
          source_identity: model_source_identity,
          kind: 'root'
        )
        root_transform_id = intern_transform(parent_transform || Geom::Transformation.new)
        @nodes.unshift(
          id: 'node:root',
          kind: 'root',
          name: root_definition[:name],
          owner_definition_id: nil,
          definition_id: root_definition_id,
          transform_id: root_transform_id,
          material_override_id: nil,
          tag_id: nil,
          source_identity: model_source_identity,
          attributes: {}
        )

        {
          format: {
            name: FORMAT_NAME,
            version: FORMAT_VERSION,
            schema: SCHEMA_URI,
            generator: {
              name: 'BOM Engine SketchUp Exporter',
              version: plugin_version
            }
          },
          source: build_source,
          units: {
            source_length_unit: source_unit_name,
            geometry_length_unit: 'meter',
            area_unit: 'square_meter',
            angle_unit: source_angle_unit
          },
          coordinate_system: {
            handedness: 'right',
            up_axis: '+Z',
            forward_axis: '-Y',
            x_axis: '+X',
            storage: 'SketchUp world axes; definition geometry is local',
            threejs_mapping: '{x,y,z}->{x,z,-y}'
          },
          metadata: build_metadata,
          tags: @tags,
          materials: @materials,
          transforms: @transforms,
          meshes: @meshes,
          definitions: @definitions,
          nodes: @nodes,
          scenes: build_scenes,
          spaces: extract_spaces,
          relationships: build_relationships,
          analysis: @spatial,
          statistics: build_statistics(identity_transform_id)
        }
      end

      private

      def build_definition(id:, name:, entities:, source_identity:, kind:, description: '', attributes: {})
        existing = @definition_index[id]
        return existing unless existing.nil?

        definition = {
          id: id,
          kind: kind,
          name: name.to_s,
          description: description.to_s,
          source_identity: source_identity,
          mesh_id: nil,
          node_ids: [],
          bounds_m: bounds_for_entities(entities),
          attributes: attributes || {}
        }
        @definition_index[id] = definition
        @definitions << definition

        mesh = build_mesh(id, entities)
        if mesh
          definition[:mesh_id] = mesh[:id]
          @meshes << mesh
        end

        each_entity(entities) do |entity|
          case entity
          when Sketchup::Group
            child_definition_id = group_definition_id(entity)
            build_definition(
              id: child_definition_id,
              name: entity.name.to_s.empty? ? '(Group)' : entity.name,
              entities: entity.entities,
              source_identity: entity_source_identity(entity),
              kind: 'group_definition',
              attributes: Traversal.extract_dicts(entity)
            )
            node = build_instance_node(entity, id, child_definition_id, 'group_instance')
            @nodes << node
            definition[:node_ids] << node[:id]
          when Sketchup::ComponentInstance
            component_definition = entity.definition
            child_definition_id = component_definition_id(component_definition)
            build_definition(
              id: child_definition_id,
              name: component_definition.name,
              description: component_definition.description,
              entities: component_definition.entities,
              source_identity: definition_source_identity(component_definition),
              kind: 'component_definition',
              attributes: Traversal.extract_dicts(component_definition)
            )
            node = build_instance_node(entity, id, child_definition_id, 'component_instance')
            node[:definition_name] = component_definition.name
            node[:dynamic_attributes] = Traversal.extract_dynamic_attrs(entity)
            @nodes << node
            definition[:node_ids] << node[:id]
          when Sketchup::Image
            node = build_image_node(entity, id)
            @nodes << node
            definition[:node_ids] << node[:id]
          when Sketchup::Text
            node = build_text_node(entity, id)
            if node
              @nodes << node
              definition[:node_ids] << node[:id]
            end
          end
        end

        definition
      end

      def build_mesh(definition_id, entities)
        positions = []
        position_index = {}
        faces = []
        edges = []

        each_entity(entities) do |entity|
          case entity
          when Sketchup::Face
            faces << build_face(entity, positions, position_index)
          when Sketchup::Edge
            next unless @settings[:include_edges]
            edges << build_edge(entity, positions, position_index)
          end
        end

        return nil if faces.empty? && edges.empty?

        {
          id: "mesh:#{definition_id}",
          definition_id: definition_id,
          coordinate_space: 'definition_local',
          positions_m: positions,
          faces: faces,
          edges: edges,
          bounds_m: bounds_from_positions(positions)
        }
      end

      def build_face(face, positions, position_index)
        outer = face.outer_loop.vertices.map do |vertex|
          intern_position(vertex.position, positions, position_index)
        end
        holes = face.loops.reject(&:outer?).map do |loop|
          loop.vertices.map { |vertex| intern_position(vertex.position, positions, position_index) }
        end
        result = {
          id: "face:#{safe_persistent_id(face)}",
          source_identity: entity_source_identity(face),
          outer: outer,
          holes: holes,
          triangles: build_face_triangles(face, positions, position_index),
          front_material_id: material_id(face.material),
          back_material_id: material_id(face.back_material),
          tag_id: tag_id(face.layer),
          normal: vector_array(face.normal),
          area_m2: (face.area.to_f * Constants::IN2_TO_M2).round(9),
          area_space: 'definition_local',
          surface_hint: Classifier.classify(face.normal),
          hidden: face.hidden?,
          attributes: Traversal.extract_dicts(face)
        }
        uv = build_face_uv(face)
        result[:uv] = uv unless uv.nil?
        result
      end

      def build_face_triangles(face, positions, position_index)
        mesh = face.mesh
        return [] unless mesh && mesh.respond_to?(:polygons)

        mesh.polygons.each_with_object([]) do |polygon, triangles|
          indices = polygon.map do |point_index|
            point = mesh.point_at(point_index.abs)
            point ? intern_position(point, positions, position_index) : nil
          end.compact
          triangles.concat(indices) if indices.length == 3
        end
      rescue StandardError => error
        @skipped["face_triangles:#{error.class}"] += 1
        []
      end

      def build_edge(edge, positions, position_index)
        {
          id: "edge:#{safe_persistent_id(edge)}",
          source_identity: entity_source_identity(edge),
          vertices: [
            intern_position(edge.start.position, positions, position_index),
            intern_position(edge.end.position, positions, position_index)
          ],
          tag_id: tag_id(edge.layer),
          hidden: edge.hidden?,
          soft: edge.soft?,
          smooth: edge.smooth?
        }
      end

      def build_face_uv(face)
        return nil if @texture_writer.nil?

        helper = face.get_UVHelper(true, true, @texture_writer)
        {
          front_outer: uv_loop(face.outer_loop, helper, :front),
          front_holes: face.loops.reject(&:outer?).map { |loop| uv_loop(loop, helper, :front) },
          back_outer: uv_loop(face.outer_loop, helper, :back),
          back_holes: face.loops.reject(&:outer?).map { |loop| uv_loop(loop, helper, :back) }
        }
      rescue StandardError => error
        @skipped["uv:#{error.class}"] += 1
        nil
      end

      def uv_loop(loop, helper, side)
        loop.vertices.map do |vertex|
          uvq = side == :front ? helper.get_front_UVQ(vertex.position) : helper.get_back_UVQ(vertex.position)
          uvq.z.to_f.zero? ? [0.0, 0.0] : [(uvq.x / uvq.z).round(9), (uvq.y / uvq.z).round(9)]
        end
      end

      def build_instance_node(entity, owner_definition_id, definition_id, kind)
        {
          id: "node:#{owner_definition_id}:#{kind}:#{safe_persistent_id(entity)}",
          kind: kind,
          name: entity.name.to_s.empty? ? fallback_instance_name(entity) : entity.name,
          owner_definition_id: owner_definition_id,
          definition_id: definition_id,
          transform_id: intern_transform(entity.transformation),
          material_override_id: material_id(entity.material),
          tag_id: tag_id(entity.layer),
          source_identity: entity_source_identity(entity),
          attributes: Traversal.extract_dicts(entity),
          visible: entity_visible?(entity)
        }
      end

      def build_image_node(image, owner_definition_id)
        data = Traversal.build_image(image, Geom::Transformation.new)
        {
          id: "node:#{owner_definition_id}:image:#{safe_persistent_id(image)}",
          kind: 'image',
          name: File.basename(data[:filename].to_s),
          owner_definition_id: owner_definition_id,
          definition_id: nil,
          transform_id: intern_transform(image.transformation),
          material_override_id: material_id(image.material),
          tag_id: tag_id(image.layer),
          source_identity: entity_source_identity(image),
          image: data,
          attributes: Traversal.extract_dicts(image),
          visible: entity_visible?(image)
        }
      end

      def build_text_node(text, owner_definition_id)
        return nil if text.point.nil?

        {
          id: "node:#{owner_definition_id}:text:#{safe_persistent_id(text)}",
          kind: 'text',
          name: text.text.to_s,
          owner_definition_id: owner_definition_id,
          definition_id: nil,
          transform_id: intern_transform(Geom::Transformation.translation(text.point)),
          material_override_id: nil,
          tag_id: tag_id(text.layer),
          source_identity: entity_source_identity(text),
          text: text.text.to_s,
          attributes: Traversal.extract_dicts(text),
          visible: entity_visible?(text)
        }
      end

      def build_tags
        @model.layers.each do |layer|
          id = "tag:#{safe_persistent_id(layer)}"
          @tag_ids[layer.object_id] = id
          color = begin
            layer.color
          rescue StandardError
            nil
          end
          @tags << {
            id: id,
            source_identity: entity_source_identity(layer),
            name: layer.name,
            visible: layer.visible?,
            color: color && color_hash(color)
          }
        end
      end

      def build_materials
        @model.materials.each do |material|
          id = "material:#{safe_persistent_id(material)}"
          @material_ids[material.object_id] = id
          color = material.color
          texture = material.texture
          item = {
            id: id,
            source_identity: entity_source_identity(material),
            name: material.name,
            display_name: material.display_name,
            color: color_hash(color),
            opacity: material.alpha.to_f.round(6),
            material_type: material.materialType,
            attributes: Traversal.extract_dicts(material)
          }
          if texture
            item[:texture] = {
              filename: texture.filename.to_s,
              source_path: texture.filename.to_s,
              width_m: (texture.width.to_f * Constants::IN_TO_M).round(9),
              height_m: (texture.height.to_f * Constants::IN_TO_M).round(9),
              image_width_px: texture.image_width,
              image_height_px: texture.image_height
            }
          end
          @materials << item
        end
      end

      def build_source
        {
          kind: 'SketchUp',
          identity: model_source_identity,
          file_path: @model.path.to_s,
          file_name: File.basename(@model.path.to_s),
          model_name: @model.name.to_s,
          model_description: @model.description.to_s,
          sketchup_version: Sketchup.version.to_s,
          sketchup_locale: (Sketchup.get_locale rescue nil),
          exported_at: Time.now.utc.iso8601,
          scope: @settings[:selection_only] ? 'selection' : 'model',
          source_modified: @model.modified?
        }
      end

      def build_metadata
        {
          model_bounds_m: bounds_hash(@model.bounds),
          georeferenced: (@model.georeferenced? rescue false),
          attributes: Traversal.extract_dicts(@model),
          export_settings: serializable_settings
        }
      end

      def build_scenes
        @model.pages.map do |page|
          camera = page.camera
          {
            id: "scene:#{page.name}",
            name: page.name,
            description: page.description,
            camera: {
              projection: camera.perspective? ? 'perspective' : 'orthographic',
              eye_m: point_array(camera.eye),
              target_m: point_array(camera.target),
              up: vector_array(camera.up),
              field_of_view_degrees: camera.perspective? ? camera.fov : nil,
              orthographic_height_m: camera.perspective? ? nil : (camera.height.to_f * Constants::IN_TO_M).round(9),
              aspect_ratio: camera.aspect_ratio
            },
            use_camera: page.use_camera?,
            transition_time_seconds: page.transition_time
          }
        end
      rescue StandardError => error
        @skipped["scenes:#{error.class}"] += 1
        []
      end

      def extract_spaces
        rooms = @spatial[:rooms] || @spatial['rooms']
        rooms.is_a?(Array) ? rooms : []
      end

      def build_relationships
        {
          openings: @spatial[:openings] || @spatial['openings'] || [],
          room_boundaries: @spatial[:room_boundaries] || @spatial['room_boundaries'] || [],
          adjacency: @spatial[:adjacency] || @spatial['adjacency'] || []
        }
      end

      def build_statistics(identity_transform_id)
        {
          definitions: @definitions.length,
          meshes: @meshes.length,
          nodes: @nodes.length,
          component_instances: @nodes.count { |node| node[:kind] == 'component_instance' },
          group_instances: @nodes.count { |node| node[:kind] == 'group_instance' },
          faces: @meshes.sum { |mesh| mesh[:faces].length },
          unique_vertices: @meshes.sum { |mesh| mesh[:positions_m].length / 3 },
          materials: @materials.length,
          tags: @tags.length,
          transforms: @transforms.length,
          identity_transform_id: identity_transform_id,
          skipped: @skipped.sort.to_h
        }
      end

      def intern_position(point, positions, index)
        values = point_array(point)
        key = values.map { |value| format('%.9f', value) }.join(',')
        existing = index[key]
        return existing unless existing.nil?

        position_id = positions.length / 3
        positions.concat(values)
        index[key] = position_id
        position_id
      end

      def intern_transform(transform)
        matrix = transform.to_a.map.with_index do |value, index|
          converted = [12, 13, 14].include?(index) ? value.to_f * Constants::IN_TO_M : value.to_f
          converted.round(9)
        end
        key = matrix.map { |value| format('%.9f', value) }.join(',')
        existing = @transform_index[key]
        return existing unless existing.nil?

        id = @transforms.length
        @transforms << matrix
        @transform_index[key] = id
        id
      end

      def each_entity(entities)
        entities.each do |entity|
          unless Traversal.exportable_entity?(entity)
            @skipped['hidden_or_invalid_entity'] += 1
            next
          end
          yield entity
        end
      end

      def bounds_for_entities(entities)
        parent = entities.respond_to?(:parent) ? entities.parent : nil
        return bounds_hash(parent.bounds) if parent && parent.respond_to?(:bounds)

        points = []
        entities.each do |entity|
          next unless entity.respond_to?(:bounds)
          bounds = entity.bounds
          points << bounds.min << bounds.max
        rescue StandardError
          next
        end
        bounds_from_point_objects(points)
      rescue StandardError
        empty_bounds
      end

      def bounds_hash(bounds)
        return empty_bounds unless bounds && bounds.valid?

        {
          min: point_array(bounds.min),
          max: point_array(bounds.max),
          size: [
            (bounds.width.to_f * Constants::IN_TO_M).round(9),
            (bounds.height.to_f * Constants::IN_TO_M).round(9),
            (bounds.depth.to_f * Constants::IN_TO_M).round(9)
          ]
        }
      rescue StandardError
        empty_bounds
      end

      def bounds_from_point_objects(points)
        return empty_bounds if points.empty?

        converted = points.map { |point| point_array(point) }
        bounds_from_vectors(converted)
      end

      def bounds_from_positions(positions)
        return empty_bounds if positions.empty?

        bounds_from_vectors(positions.each_slice(3).to_a)
      end

      def bounds_from_vectors(vectors)
        min = [Float::INFINITY, Float::INFINITY, Float::INFINITY]
        max = [-Float::INFINITY, -Float::INFINITY, -Float::INFINITY]
        vectors.each do |vector|
          3.times do |axis|
            min[axis] = vector[axis] if vector[axis] < min[axis]
            max[axis] = vector[axis] if vector[axis] > max[axis]
          end
        end
        {
          min: min.map { |value| value.round(9) },
          max: max.map { |value| value.round(9) },
          size: 3.times.map { |axis| (max[axis] - min[axis]).round(9) }
        }
      end

      def empty_bounds
        { min: [0.0, 0.0, 0.0], max: [0.0, 0.0, 0.0], size: [0.0, 0.0, 0.0] }
      end

      def point_array(point)
        [
          (point.x.to_f * Constants::IN_TO_M).round(9),
          (point.y.to_f * Constants::IN_TO_M).round(9),
          (point.z.to_f * Constants::IN_TO_M).round(9)
        ]
      end

      def vector_array(vector)
        [vector.x.to_f.round(9), vector.y.to_f.round(9), vector.z.to_f.round(9)]
      end

      def color_hash(color)
        {
          r: color.red,
          g: color.green,
          b: color.blue,
          a: color.alpha,
          hex: format('#%02X%02X%02X', color.red, color.green, color.blue)
        }
      end

      def material_id(material)
        return nil if material.nil?
        @material_ids[material.object_id]
      end

      def tag_id(layer)
        return nil if layer.nil?
        @tag_ids[layer.object_id]
      end

      def root_definition_id
        scope = @settings[:selection_only] ? 'selection' : 'model'
        "definition:root:#{source_token(@model.guid)}:#{scope}"
      end

      def component_definition_id(definition)
        identity = definition.guid.to_s
        identity = safe_persistent_id(definition) if identity.empty?
        "definition:component:#{source_token(identity)}"
      end

      def group_definition_id(group)
        "definition:group:#{source_token(safe_persistent_id(group))}"
      end

      def source_token(value)
        value.to_s.gsub(/[^A-Za-z0-9._-]+/, '-').gsub(/^-|-$/, '')
      end

      def safe_persistent_id(entity)
        value = entity.persistent_id if entity.respond_to?(:persistent_id)
        value = entity.entityID if (value.nil? || value.to_i.zero?) && entity.respond_to?(:entityID)
        value = entity.object_id if value.nil?
        value.to_s
      rescue StandardError
        entity.object_id.to_s
      end

      def entity_source_identity(entity)
        identity = {
          persistent_id: safe_persistent_id(entity),
          entity_type: entity.class.name
        }
        identity[:guid] = entity.guid.to_s if entity.respond_to?(:guid) && !entity.guid.to_s.empty?
        identity
      rescue StandardError
        { persistent_id: safe_persistent_id(entity), entity_type: entity.class.name }
      end

      def definition_source_identity(definition)
        identity = entity_source_identity(definition)
        identity[:guid] = definition.guid.to_s
        identity[:name] = definition.name.to_s
        identity
      end

      def model_source_identity
        { guid: @model.guid.to_s, entity_type: 'Sketchup::Model' }
      end

      def fallback_instance_name(entity)
        entity.respond_to?(:definition) ? entity.definition.name.to_s : '(Instance)'
      end

      def entity_visible?(entity)
        visible = entity.respond_to?(:visible?) ? entity.visible? : true
        layer_visible = entity.respond_to?(:layer) && entity.layer ? entity.layer.visible? : true
        visible && layer_visible && !(entity.respond_to?(:hidden?) && entity.hidden?)
      rescue StandardError
        true
      end

      def serializable_settings
        @settings.each_with_object({}) do |(key, value), result|
          result[key] = value if value.nil? || value.is_a?(String) || value.is_a?(Numeric) || value == true || value == false
        end
      end

      def plugin_version
        defined?(BOMEngine::PLUGIN_VERSION) ? BOMEngine::PLUGIN_VERSION : 'development'
      end

      UNIT_NAMES = %w[Inches Feet Millimeters Centimeters Meters Kilometers].freeze

      def source_unit_name
        options = @model.options['UnitsOptions']
        UNIT_NAMES[options['LengthUnit'].to_i] || 'Unknown'
      rescue StandardError
        'Unknown'
      end

      def source_angle_unit
        options = @model.options['UnitsOptions']
        options['AngleUnits'].to_i.zero? ? 'degree' : 'radian'
      rescue StandardError
        'degree'
      end
    end
  end
end
