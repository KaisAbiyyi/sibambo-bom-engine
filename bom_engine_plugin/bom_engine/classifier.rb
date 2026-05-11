# bom_engine/classifier.rb
# Classifies faces by surface type based on their world-space normal vector.

module BOMEngine
  module Classifier

    # Classify a face by its world-space normal vector.
    #
    # Returns one of:
    #   "floor", "ceiling", "wall_x_pos", "wall_x_neg",
    #   "wall_y_pos", "wall_y_neg", "roof_slope", "unknown"
    #
    # @param normal [Geom::Vector3d] world-space normalized normal
    # @return [String]
    def self.classify(normal)
      nz = normal.z
      nx = normal.x.abs
      ny = normal.y.abs

      # Horizontal surfaces (floor / ceiling)
      if nz.abs > Constants::HORIZONTAL_THRESHOLD
        return nz > 0 ? "floor" : "ceiling"
      end

      # Near-vertical slopes: 15°–55° from horizontal → roof slope
      if nz.abs > Constants::ROOF_SLOPE_MIN && nz.abs <= Constants::HORIZONTAL_THRESHOLD
        return "roof_slope"
      end

      # Vertical walls — dominant horizontal direction
      if nx >= ny
        normal.x > 0 ? "wall_x_pos" : "wall_x_neg"
      else
        normal.y > 0 ? "wall_y_pos" : "wall_y_neg"
      end
    end

    # Simplified 4-category version used for BOM mapping.
    #
    # @param normal [Geom::Vector3d]
    # @return [String] one of "floor", "ceiling", "wall", "unknown"
    def self.simplified(normal)
      full = classify(normal)
      case full
      when "floor"     then "floor"
      when "ceiling"   then "ceiling"
      when /^wall_/    then "wall"
      when "roof_slope" then "ceiling"  # treat as ceiling for BOM purposes
      else                  "unknown"
      end
    end

    # Cardinal facade orientation for daylight / solar analysis.
    # Assumes SketchUp green axis (Y+) = North (adjustable via north_angle_deg).
    #
    # @param normal         [Geom::Vector3d] wall normal (should be near-vertical)
    # @param north_angle_deg [Float] model north correction from shadow_info
    # @return [String] "north", "south", "east", or "west"
    def self.facade_orientation(normal, north_angle_deg = 0.0)
      angle_rad = north_angle_deg * Math::PI / 180.0
      nx_rot = normal.x * Math.cos(angle_rad) - normal.y * Math.sin(angle_rad)
      ny_rot = normal.x * Math.sin(angle_rad) + normal.y * Math.cos(angle_rad)

      if ny_rot.abs >= nx_rot.abs
        ny_rot >= 0 ? "north" : "south"
      else
        nx_rot >= 0 ? "east" : "west"
      end
    end

  end
end
