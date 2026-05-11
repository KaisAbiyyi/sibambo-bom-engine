# bom_engine/traversal.rb
# Recursive entity tree walker.
# Converts all coordinates from SketchUp inches to meters (world-space absolute).

module BOMEngine
  module Traversal

    # Walk the full entity tree recursively.
    # Returns an array of entity hashes with world-space coordinates.
    #
    # @param entities  [Sketchup::Entities or Sketchup::Selection]
    # @param tw        [Sketchup::TextureWriter, nil]
    # @param parent_tf [Geom::Transformation] accumulated world transform
    # @param depth     [Integer] recursion depth (safety guard)
    # @param opts      [Hash]  :include_edges => Boolean, :export_level => String
    # @return          [Array<Hash>]
    def self.walk(entities, tw, parent_tf, depth = 0, opts = {})
      result        = []
      include_edges = opts.fetch(:include_edges, Constants::INCLUDE_EDGES)
      level         = opts.fetch(:export_level, "full")

      if depth > Constants::MAX_RECURSION_DEPTH
        Logger.warn("Max recursion depth #{Constants::MAX_RECURSION_DEPTH} reached. Skipping subtree.")
        return result
      end

      entities.each do |entity|
        next if entity.nil? || entity.deleted?

        case entity
        when Sketchup::Face
          result << build_face(entity, tw, parent_tf, level)

        when Sketchup::Edge
          result << build_edge(entity, parent_tf) if include_edges && level == "full"

        when Sketchup::Group
          child_tf = parent_tf * entity.transformation
          h = {
            type:     "Group",
            name:     entity.name.empty? ? "(Group)" : entity.name,
            children: walk(entity.entities, tw, child_tf, depth + 1, opts)
          }
          if level == "standard" || level == "full"
            h[:layer]      = safe_layer_name(entity)
            h[:guid]       = entity.guid
            h[:face_count] = count_faces(entity.entities)
          end
          if level == "full"
            h[:id]             = entity.persistent_id.to_s
            h[:edge_count]     = include_edges ? count_edges(entity.entities) : 0
            h[:transform]      = entity.transformation.to_a
            h[:transform_data] = decompose_transform(entity.transformation)
            h[:bounding_box]   = bbox_hash(entity.bounds, parent_tf)
            h[:attributes]     = extract_dicts(entity)
          end
          result << h

        when Sketchup::ComponentInstance
          defn     = entity.definition
          child_tf = parent_tf * entity.transformation
          h = {
            type:            "ComponentInstance",
            name:            entity.name.empty? ? defn.name : entity.name,
            definition_name: defn.name,
            children:        walk(defn.entities, tw, child_tf, depth + 1, opts)
          }
          if level == "standard" || level == "full"
            h[:layer]          = safe_layer_name(entity)
            h[:guid]           = entity.guid
            h[:instance_count] = defn.instances.length
            h[:face_count]     = count_faces(defn.entities)
            h[:world_center]   = pt_to_m(child_tf * defn.bounds.center)
          end
          if level == "full"
            h[:id]                 = entity.persistent_id.to_s
            h[:definition_guid]    = defn.guid
            h[:edge_count]         = include_edges ? count_edges(defn.entities) : 0
            h[:transform]          = entity.transformation.to_a
            h[:transform_data]     = decompose_transform(entity.transformation)
            h[:bounding_box]       = bbox_hash(entity.bounds, parent_tf)
            h[:dynamic_attributes] = extract_dynamic_attrs(entity)
            h[:attributes]         = extract_dicts(entity)
          end
          result << h

        when Sketchup::Image
          result << build_image(entity, parent_tf) if level == "full"

        when Sketchup::Text
          if level == "full"
            next if entity.point.nil?
            result << {
              type:     "Text",
              text:     entity.text,
              position: pt_to_m(parent_tf * entity.point)
            }
          end

        when Sketchup::ConstructionLine
          if level == "full" && Constants::INCLUDE_CONSTRUCTION_LINES
            result << {
              type:  "ConstructionLine",
              start: pt_to_m(parent_tf * entity.start),
              end:   pt_to_m(parent_tf * entity.end)
            }
          end

        end
      end

      result
    end

    # ── Face builder ────────────────────────────────────────────

    def self.build_face(face, tw, tf, level = "full")
      normal_world = face.normal.transform(tf).normalize
      surface_type = Classifier.classify(normal_world)
      area_m2      = (face.area * Constants::IN2_TO_M2).round(4)

      # ── Visual: minimal — only what the web viewer needs ────
      if level == "visual"
        vertices = face.outer_loop.vertices.map do |v|
          { position: pt_to_m(tf * v.position) }
        end
        return {
          type:         "Face",
          layer:        safe_layer_name(face),
          surface_type: surface_type,
          normal:       vec_hash(normal_world),
          area_m2:      area_m2,
          vertices:     vertices
        }
      end

      # ── Standard: adds holes, simplified material color ──────
      uv_helper = (level == "full") ? (face.get_UVHelper(true, true, tw) rescue nil) : nil

      outer_vertices = face.outer_loop.vertices.map do |v|
        world_pt = tf * v.position
        h = { position: pt_to_m(world_pt) }
        h[:uv] = extract_uv(uv_helper, v.position) if level == "full"
        h
      end

      holes = face.loops.reject(&:outer?).map do |loop|
        loop.vertices.map { |v| pt_to_m(tf * v.position) }
      end

      h = {
        type:         "Face",
        layer:        safe_layer_name(face),
        surface_type: surface_type,
        area_m2:      area_m2,
        normal:       vec_hash(normal_world),
        vertices:     outer_vertices,
        holes:        holes,
        has_holes:    !holes.empty?,
        hole_count:   holes.length
      }

      if level == "standard"
        # Include only the hex color of front material
        m = face.material
        h[:mat_color] = m ? "#%02x%02x%02x" % [m.color.red, m.color.green, m.color.blue] : nil
        return h
      end

      # ── Full: everything ─────────────────────────────────────
      h[:id]              = face.persistent_id.to_s
      h[:surface_simple]  = Classifier.simplified(normal_world)
      h[:material_front]  = material_hash(face.material)
      h[:material_back]   = material_hash(face.back_material)
      h[:attributes]      = extract_dicts(face)
      h
    end

    # ── Edge builder ────────────────────────────────────────────

    def self.build_edge(edge, tf)
      {
        type:     "Edge",
        id:       edge.persistent_id.to_s,
        layer:    safe_layer_name(edge),
        start:    pt_to_m(tf * edge.start.position),
        end:      pt_to_m(tf * edge.end.position),
        length_m: (edge.length * Constants::IN_TO_M).round(5),
        hidden:   edge.hidden?,
        soft:     edge.soft?,
        smooth:   edge.smooth?
      }
    end

    # ── Image entity builder ────────────────────────────────────

    def self.build_image(img, tf)
      fname = begin
        if img.respond_to?(:image_rep)
          img.image_rep.file rescue nil
        elsif img.respond_to?(:filename)
          img.filename rescue nil
        end
      rescue
        nil
      end

      {
        type:     "ImageEntity",
        id:       img.persistent_id.to_s,
        filename: fname,
        width_m:  (img.width  * Constants::IN_TO_M).round(4),
        height_m: (img.height * Constants::IN_TO_M).round(4),
        position: pt_to_m(tf * img.origin)
      }
    end

    # ── Transform decomposition ─────────────────────────────────

    def self.decompose_transform(tf)
      m = tf.to_a

      tx = (m[12] * Constants::IN_TO_M).round(5)
      ty = (m[13] * Constants::IN_TO_M).round(5)
      tz = (m[14] * Constants::IN_TO_M).round(5)

      sx = Math.sqrt(m[0]**2 + m[1]**2  + m[2]**2).round(6)
      sy = Math.sqrt(m[4]**2 + m[5]**2  + m[6]**2).round(6)
      sz = Math.sqrt(m[8]**2 + m[9]**2  + m[10]**2).round(6)

      rx = sx > 0 ? [m[0]/sx, m[1]/sx,  m[2]/sx]  : [1,0,0]
      ry = sy > 0 ? [m[4]/sy, m[5]/sy,  m[6]/sy]  : [0,1,0]
      rz = sz > 0 ? [m[8]/sz, m[9]/sz,  m[10]/sz] : [0,0,1]

      {
        position:      { x: tx, y: ty, z: tz },
        scale:         { x: sx, y: sy, z: sz },
        rotation_cols: { x: rx, y: ry, z: rz },
        raw_matrix:    m.map { |v| v.round(8) }
      }
    end

    # ── Count helpers ───────────────────────────────────────────

    def self.count_faces(entities, depth = 0)
      return 0 if depth > Constants::MAX_RECURSION_DEPTH
      entities.inject(0) do |sum, e|
        next sum if e.nil? || e.deleted?
        case e
        when Sketchup::Face             then sum + 1
        when Sketchup::Group            then sum + count_faces(e.entities, depth + 1)
        when Sketchup::ComponentInstance then sum + count_faces(e.definition.entities, depth + 1)
        else sum
        end
      end
    end

    def self.count_edges(entities, depth = 0)
      return 0 if depth > Constants::MAX_RECURSION_DEPTH
      entities.inject(0) do |sum, e|
        next sum if e.nil? || e.deleted?
        case e
        when Sketchup::Edge             then sum + 1
        when Sketchup::Group            then sum + count_edges(e.entities, depth + 1)
        when Sketchup::ComponentInstance then sum + count_edges(e.definition.entities, depth + 1)
        else sum
        end
      end
    end

    # ── Coordinate helpers ──────────────────────────────────────

    def self.pt_to_m(pt)
      {
        x: (pt.x * Constants::IN_TO_M).round(6),
        y: (pt.y * Constants::IN_TO_M).round(6),
        z: (pt.z * Constants::IN_TO_M).round(6)
      }
    end

    def self.vec_hash(v)
      { x: v.x.round(6), y: v.y.round(6), z: v.z.round(6) }
    end

    def self.bbox_hash(bb, tf)
      min = tf * bb.min
      max = tf * bb.max
      {
        min:      pt_to_m(min),
        max:      pt_to_m(max),
        center:   pt_to_m(tf * bb.center),
        width_m:  ((max.x - min.x) * Constants::IN_TO_M).round(4),
        depth_m:  ((max.y - min.y) * Constants::IN_TO_M).round(4),
        height_m: ((max.z - min.z) * Constants::IN_TO_M).round(4)
      }
    rescue
      { min: nil, max: nil }
    end

    # ── Entity attribute helpers ────────────────────────────────

    def self.safe_layer_name(entity)
      entity.respond_to?(:layer) && entity.layer ? entity.layer.name : "Layer0"
    rescue
      "Layer0"
    end

    def self.extract_uv(uv_helper, local_pt)
      return { u: 0.0, v: 0.0 } if uv_helper.nil?
      uvq = uv_helper.get_front_UVQ(local_pt)
      return { u: 0.0, v: 0.0 } if uvq.z == 0
      { u: (uvq.x / uvq.z).round(6), v: (uvq.y / uvq.z).round(6) }
    rescue
      { u: 0.0, v: 0.0 }
    end

    # SNI-standard acoustic absorption coefficients at 500 Hz (Sabine)
    ABSORPTION_TABLE = {
      /bata|brick/           => 0.03,
      /beton|concrete/       => 0.02,
      /kayu|wood|parket/     => 0.10,
      /karpet|carpet/        => 0.35,
      /kaca|glass|jendela/   => 0.04,
      /tirai|curtain/        => 0.40,
      /plester|plaster/      => 0.04,
      /busa|foam/            => 0.70,
      /keramik|tile|ceramic/ => 0.02,
      /metal|besi|steel/     => 0.02,
      /kain|fabric|textile/  => 0.35,
      /cat|paint/            => 0.04,
      /granit|granite/       => 0.02,
    }.freeze

    def self.estimate_absorption(name)
      name_down = name.to_s.downcase
      ABSORPTION_TABLE.each { |pat, val| return val if name_down.match?(pat) }
      0.05
    end

    def self.estimate_reflectance(color)
      ((0.299 * color.red + 0.587 * color.green + 0.114 * color.blue) / 255.0).round(4)
    end

    def self.material_hash(mat)
      return nil if mat.nil?
      c = mat.color
      h = {
        name:                mat.name,
        display_name:        mat.display_name,
        color:               { r: c.red, g: c.green, b: c.blue, a: c.alpha,
                               hex: "#%02x%02x%02x" % [c.red, c.green, c.blue] },
        alpha:               mat.alpha,
        material_type:       mat.materialType,
        reflectance:         estimate_reflectance(c),
        acoustic_absorption: estimate_absorption(mat.name)
      }
      if mat.texture
        h[:texture] = {
          filename:        mat.texture.filename,
          width_m:         (mat.texture.width  * Constants::IN_TO_M).round(4),
          height_m:        (mat.texture.height * Constants::IN_TO_M).round(4),
          image_width_px:  mat.texture.image_width,
          image_height_px: mat.texture.image_height
        }
      end
      h
    end

    def self.extract_dicts(entity)
      result = {}
      return result unless entity.respond_to?(:attribute_dictionaries)
      return result if entity.attribute_dictionaries.nil?
      entity.attribute_dictionaries.each do |dict|
        result[dict.name] = {}
        dict.each { |k, v| result[dict.name][k] = v.to_s rescue nil }
      end
      result
    end

    def self.extract_dynamic_attrs(instance)
      dict = instance.attribute_dictionary("dynamic_attributes") rescue nil
      return {} if dict.nil?
      h = {}
      dict.each { |k, v| h[k] = v.to_s rescue nil }
      h
    end

  end
end
