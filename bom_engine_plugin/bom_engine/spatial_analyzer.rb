# bom_engine/spatial_analyzer.rb
# Computes aggregate spatial metrics for the model:
# surface areas, opening counts, facade orientations, room detection, geolocation.

require 'ostruct'

module BOMEngine
  module SpatialAnalyzer

    # Analyze only the given selected entities (partial export).
    # @param selection  [Sketchup::Selection] current selection
    # @param context_tf [Geom::Transformation] world transform of the editing context
    # @return [Hash] spatial analysis payload
    def self.analyze_entities(selection, context_tf)
      all_faces = collect_all_faces(selection, context_tf)
      build_analysis(all_faces, bounding_box_for(all_faces), north_angle: 0.0)
    end

    # Analyze the full model.
    # @param model [Sketchup::Model]
    # @return [Hash] spatial analysis payload
    def self.analyze(model)
      all_faces   = collect_all_faces(model.entities, Geom::Transformation.new)
      north_angle = begin model.shadow_info["NorthAngle"] rescue 0.0 end
      result      = build_analysis(all_faces, model.bounds, north_angle: north_angle)
      result[:geolocation] = extract_geolocation(model)
      result
    end

    private

    # Core analysis logic shared by both analyze() and analyze_entities().
    # @param all_faces   [Array<Hash>] pre-collected face hashes
    # @param bb          [Sketchup::BoundingBox, nil]
    # @param north_angle [Float] model north angle in degrees
    def self.build_analysis(all_faces, bb, north_angle: 0.0)
      openings = OpeningDetector.detect(all_faces)

      floors   = all_faces.select { |f| f[:surface_type] == "floor" }
      ceilings = all_faces.select { |f| f[:surface_type] == "ceiling" }
      walls    = all_faces.select { |f| f[:surface_type] =~ /^wall/ }
      slopes   = all_faces.select { |f| f[:surface_type] == "roof_slope" }

      floor_area   = floors.sum   { |f| f[:area_m2] }
      ceiling_area = ceilings.sum { |f| f[:area_m2] }
      wall_area    = walls.sum    { |f| f[:area_m2] }
      slope_area   = slopes.sum   { |f| f[:area_m2] }

      opening_area  = openings.sum { |o| o[:estimated_area_m2] }
      net_wall_area = [wall_area - opening_area, 0].max

      facade_data = analyze_facades(walls, north_angle)
      rooms       = detect_rooms(floors, walls)

      bb_hash = bb ? bbox_world(bb) : {}
      dims    = bb ? {
        width_m:  ((bb.max.x - bb.min.x) * Constants::IN_TO_M).round(3),
        depth_m:  ((bb.max.y - bb.min.y) * Constants::IN_TO_M).round(3),
        height_m: ((bb.max.z - bb.min.z) * Constants::IN_TO_M).round(3)
      } : {}

      {
        bounding_box:        bb_hash,
        building_dimensions: dims,
        surface_summary: {
          total_faces:             all_faces.length,
          floor_faces:             floors.length,
          ceiling_faces:           ceilings.length,
          wall_faces:              walls.length,
          roof_slope_faces:        slopes.length,
          total_floor_area_m2:     floor_area.round(3),
          total_ceiling_area_m2:   ceiling_area.round(3),
          total_wall_area_m2:      wall_area.round(3),
          gross_wall_area_m2:      wall_area.round(3),
          net_wall_area_m2:        net_wall_area.round(3),
          total_opening_area_m2:   opening_area.round(3),
          wall_to_floor_ratio:     floor_area > 0 ? (wall_area / floor_area).round(3) : 0,
          window_to_wall_ratio:    wall_area  > 0 ? (opening_area / wall_area).round(3) : 0,
          roof_slope_area_m2:      slope_area.round(3)
        },
        openings:            openings,
        facade_orientations: facade_data,
        rooms:               rooms,
        estimated_volume_m3: bb ? estimate_volume(bb) : 0,
        geolocation:         nil
      }
    end

    # Compute a synthetic BoundingBox from a flat list of face hashes.
    def self.bounding_box_for(all_faces)
      return nil if all_faces.empty?
      all_pts = all_faces.flat_map { |f| f[:holes].flatten + (f[:centroid] ? [f[:centroid]] : []) }
      return nil if all_pts.empty?
      xs = all_pts.map { |p| p[:x] }
      ys = all_pts.map { |p| p[:y] }
      zs = all_pts.map { |p| p[:z] }
      # Return as a simple struct-like hash (not a SketchUp BoundingBox)
      OpenStruct.new(
        min:    OpenStruct.new(x: xs.min / Constants::IN_TO_M, y: ys.min / Constants::IN_TO_M, z: zs.min / Constants::IN_TO_M),
        max:    OpenStruct.new(x: xs.max / Constants::IN_TO_M, y: ys.max / Constants::IN_TO_M, z: zs.max / Constants::IN_TO_M),
        center: OpenStruct.new(
          x: ((xs.min + xs.max) / 2) / Constants::IN_TO_M,
          y: ((ys.min + ys.max) / 2) / Constants::IN_TO_M,
          z: ((zs.min + zs.max) / 2) / Constants::IN_TO_M
        )
      )
    end

    def self.collect_all_faces(entities, tf, result = [])
      entities.each do |e|
        case e
        when Sketchup::Face
          n = e.normal.transform(tf).normalize
          result << {
            id:           e.persistent_id.to_s,
            normal:       Traversal.vec_hash(n),
            area_m2:      (e.area * Constants::IN2_TO_M2).round(4),
            surface_type: Classifier.classify(n),
            holes:        e.loops.reject(&:outer?).map { |l|
                            l.vertices.map { |v| Traversal.pt_to_m(tf * v.position) }
                          },
            centroid:     Traversal.pt_to_m(face_centroid(e, tf))
          }
        when Sketchup::Group
          collect_all_faces(e.entities, tf * e.transformation, result)
        when Sketchup::ComponentInstance
          collect_all_faces(e.definition.entities, tf * e.transformation, result)
        end
      end
      result
    end

    def self.face_centroid(face, tf)
      pts = face.outer_loop.vertices.map { |v| tf * v.position }
      cx  = pts.sum(&:x) / pts.length
      cy  = pts.sum(&:y) / pts.length
      cz  = pts.sum(&:z) / pts.length
      Geom::Point3d.new(cx, cy, cz)
    end

    def self.analyze_facades(wall_faces, north_angle = 0.0)
      counts = Hash.new(0)
      areas  = Hash.new(0.0)

      wall_faces.each do |f|
        n   = Geom::Vector3d.new(f[:normal][:x], f[:normal][:y], f[:normal][:z])
        dir = Classifier.facade_orientation(n, north_angle)
        counts[dir] += 1
        areas[dir]  += f[:area_m2]
      end

      {
        face_count:      counts,
        area_m2:         areas.transform_values { |v| v.round(3) },
        north_angle_deg: north_angle
      }
    end

    # Simple room detection: each contiguous floor face is treated as a room.
    # TODO: implement proper connectivity-based room outline detection.
    def self.detect_rooms(floor_faces, _wall_faces)
      floor_faces.each_with_index.map do |floor, i|
        {
          room_id:       "room_#{i + 1}",
          floor_area_m2: floor[:area_m2],
          centroid:      floor[:centroid],
          estimated_perimeter_m: nil
        }
      end
    end

    def self.estimate_volume(bb)
      w = (bb.max.x - bb.min.x) * Constants::IN_TO_M
      d = (bb.max.y - bb.min.y) * Constants::IN_TO_M
      h = (bb.max.z - bb.min.z) * Constants::IN_TO_M
      (w * d * h).round(3)
    end

    def self.bbox_world(bb)
      {
        min:    Traversal.pt_to_m(bb.min),
        max:    Traversal.pt_to_m(bb.max),
        center: Traversal.pt_to_m(bb.center)
      }
    end

    def self.extract_geolocation(model)
      si = model.shadow_info
      {
        latitude:        si["Latitude"],
        longitude:       si["Longitude"],
        location_name:   si["City"],
        timezone_offset: si["TZOffset"],
        north_angle_deg: si["NorthAngle"],
        sun_enabled:     si["DisplayShadows"],
        sun_time:        si["ShadowTime"].to_s
      }
    rescue
      { latitude: nil, longitude: nil }
    end

  end
end
