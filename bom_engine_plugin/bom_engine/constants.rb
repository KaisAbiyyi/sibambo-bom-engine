# bom_engine/constants.rb
# Shared constants used across all BOM Engine modules.

module BOMEngine
  module Constants

    # ── Unit conversion ────────────────────────────────────────────
    # SketchUp internal unit is inches
    IN_TO_M   = 0.0254
    IN2_TO_M2 = IN_TO_M ** 2
    IN3_TO_M3 = IN_TO_M ** 3

    # ── Surface classification thresholds ─────────────────────────
    # |nz| > 0.85 → floor or ceiling (within ~32° of horizontal)
    HORIZONTAL_THRESHOLD = 0.85
    # |nz| > 0.25 AND ≤ 0.85 → roof slope
    ROOF_SLOPE_MIN       = 0.25

    # ── Opening detection thresholds (meters) ─────────────────────
    # centroid z < 0.40m → door (at ground level)
    DOOR_HEIGHT_THRESHOLD = 0.40
    # centroid z < 2.50m → window; else skylight
    WINDOW_SILL_MAX       = 2.50
    # area > 3m² → double door
    LARGE_DOOR_AREA_M2    = 3.0
    # area > 2m² → large window
    LARGE_WINDOW_AREA_M2  = 2.0

    # ── Traversal limits ──────────────────────────────────────────
    MAX_RECURSION_DEPTH   = 50

    # ── Feature flags ─────────────────────────────────────────────
    # Edges make JSON very large — disabled by default
    INCLUDE_EDGES              = false
    INCLUDE_CONSTRUCTION_LINES = false

  end
end
