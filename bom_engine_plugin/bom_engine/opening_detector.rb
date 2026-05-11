# bom_engine/opening_detector.rb
# Detects openings (doors, windows, skylights) from face inner loops.

module BOMEngine
  module OpeningDetector

    # Detect openings from collected face data.
    # Called after traversal has accumulated all faces with holes.
    #
    # @param all_faces [Array<Hash>] face hashes from Traversal.walk / SpatialAnalyzer
    # @return [Array<Hash>] opening descriptors
    def self.detect(all_faces)
      openings = []

      all_faces.each do |face|
        next if face[:holes].nil? || face[:holes].empty?

        face[:holes].each_with_index do |hole_verts, idx|
          next if hole_verts.length < 3

          # Centroid of the hole polygon
          cx = hole_verts.sum { |v| v[:x] } / hole_verts.length
          cy = hole_verts.sum { |v| v[:y] } / hole_verts.length
          cz = hole_verts.sum { |v| v[:z] } / hole_verts.length

          area = polygon_area(hole_verts, face[:normal])
          type = classify_opening_type(cz, area)

          orientation = nil
          if face[:surface_type].to_s =~ /wall/
            n = Geom::Vector3d.new(
              face[:normal][:x],
              face[:normal][:y],
              face[:normal][:z]
            )
            orientation = Classifier.facade_orientation(n)
          end

          openings << {
            id:                  "#{face[:id]}_hole_#{idx}",
            parent_face_id:      face[:id],
            opening_type:        type,
            surface_type:        face[:surface_type],
            normal:              face[:normal],
            centroid:            { x: cx.round(4), y: cy.round(4), z: cz.round(4) },
            estimated_area_m2:   area.round(4),
            vertex_count:        hole_verts.length,
            facade_orientation:  orientation,
            height_estimate_m:   estimate_height(hole_verts),
            width_estimate_m:    estimate_width(hole_verts)
          }
        end
      end

      openings
    end

    private

    # Shoelace-based polygon area in 3D (projects cross-products).
    def self.polygon_area(verts, _normal)
      return 0.0 if verts.length < 3
      area = 0.0
      n    = verts.length
      n.times do |i|
        j  = (i + 1) % n
        ax = verts[j][:x] - verts[0][:x]
        ay = verts[j][:y] - verts[0][:y]
        az = verts[j][:z] - verts[0][:z]
        bx = verts[i][:x] - verts[0][:x]
        by = verts[i][:y] - verts[0][:y]
        bz = verts[i][:z] - verts[0][:z]
        cx = ay * bz - az * by
        cy = az * bx - ax * bz
        cz = ax * by - ay * bx
        area += Math.sqrt(cx**2 + cy**2 + cz**2)
      end
      area / 2.0
    end

    def self.classify_opening_type(centroid_z, area_m2)
      if centroid_z < Constants::DOOR_HEIGHT_THRESHOLD
        area_m2 > Constants::LARGE_DOOR_AREA_M2 ? "double_door" : "door"
      elsif centroid_z < Constants::WINDOW_SILL_MAX
        area_m2 > Constants::LARGE_WINDOW_AREA_M2 ? "large_window" : "window"
      else
        "skylight"
      end
    end

    def self.estimate_height(verts)
      zs = verts.map { |v| v[:z] }
      (zs.max - zs.min).round(4)
    end

    def self.estimate_width(verts)
      xs = verts.map { |v| v[:x] }
      ys = verts.map { |v| v[:y] }
      dx = xs.max - xs.min
      dy = ys.max - ys.min
      Math.sqrt(dx**2 + dy**2).round(4)
    end

  end
end
