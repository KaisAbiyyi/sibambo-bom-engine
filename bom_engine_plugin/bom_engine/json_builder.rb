# bom_engine/json_builder.rb
# Assembles the final JSON payload from all collected data.

module BOMEngine
  module JSONBuilder

    SCHEMA_VERSION = "2.1"

    # Build the export hash, content varies by export_level.
    #
    # @param model     [Sketchup::Model]
    # @param entities  [Array<Hash>]
    # @param materials [Array<Hash>]
    # @param spatial   [Hash]
    # @param settings  [Hash]
    # @param compact_mesh [Hash, nil]
    # @return          [Hash]
    def self.build(model:, entities:, materials:, spatial:, settings:, compact_mesh: nil)
      level = settings[:export_level].to_s
      level = "full" unless %w[visual standard full].include?(level)
      compact = !compact_mesh.nil?

      base = {
        schema_version: SCHEMA_VERSION,
        export_level:   level,
        exported_at:    Time.now.utc.iso8601,
        geometry_format: compact ? "compact_mesh_v1" : "sketchup_mesh_polygons"
      }
      if compact
        base[:mesh] = compact_mesh
        base[:entities] = []
      else
        base[:entities] = entities
      end

      return base if level == "visual"

      # ── Standard: add metadata, units, tags, scenes ─────────
      opts = model.options
      base[:metadata] = {
        name:        model.name,
        description: model.description,
        guid:        model.guid
      }
      base[:units] = {
        length_unit_name: unit_name(opts["UnitsOptions"]["LengthUnit"]),
        output_unit:      "meters"
      }
      base[:tags]   = build_tags(model)
      base[:scenes] = build_scenes_minimal(model)

      return base if level == "standard"

      # ── Full: everything ─────────────────────────────────────
      base[:software]              = "SketchUp #{Sketchup.version}"
      base[:plugin_version]        = BOMEngine::PLUGIN_VERSION
      base[:metadata][:filepath]   = model.path
      base[:metadata][:attribute_dictionaries] = Traversal.extract_dicts(model)
      base[:units][:length_unit_id]  = opts["UnitsOptions"]["LengthUnit"]
      base[:units][:precision]       = opts["UnitsOptions"]["LengthPrecision"]
      base[:units][:angle_unit]      = opts["UnitsOptions"]["AngleUnits"] == 0 ? "degrees" : "radians"
      base[:shadow_settings]         = build_shadow(model)
      base[:scenes]                  = build_scenes(model)
      base[:component_definitions]   = build_definitions(model)
      base[:materials]               = settings[:include_materials] == false ? [] : materials
      base[:spatial_analysis]        = spatial
      base
    end

    private

    UNIT_NAMES = %w[Inches Feet Millimeters Centimeters Meters Kilometers].freeze

    def self.unit_name(id)
      UNIT_NAMES[id.to_i] || "Unknown"
    end

    def self.build_shadow(model)
      si = model.shadow_info
      {
        shadows_enabled:     si["DisplayShadows"],
        use_sun_for_shading: si["UseSunForAllShading"],
        light_intensity:     si["Light"],
        dark_intensity:      si["Dark"]
      }
    rescue
      {}
    end

    def self.build_tags(model)
      model.layers.map do |layer|
        {
          name:    layer.name,
          visible: layer.visible?,
          color:   begin
                     c = layer.color
                     { r: c.red, g: c.green, b: c.blue }
                   rescue
                     nil
                   end
        }
      end
    end

    # Minimal scenes — camera position only (for Standard level)
    def self.build_scenes_minimal(model)
      model.pages.map do |page|
        cam = page.camera
        {
          name: page.name,
          camera: {
            eye:    Traversal.pt_to_m(cam.eye),
            target: Traversal.pt_to_m(cam.target)
          }
        }
      end
    rescue
      []
    end

    def self.build_scenes(model)
      model.pages.map do |page|
        cam = page.camera
        {
          name:            page.name,
          description:     page.description,
          camera: {
            eye:          Traversal.pt_to_m(cam.eye),
            target:       Traversal.pt_to_m(cam.target),
            up:           Traversal.vec_hash(cam.up),
            fov:          cam.fov,
            perspective:  cam.perspective?,
            aspect_ratio: cam.aspect_ratio
          },
          use_camera:      page.use_camera?,
          transition_time: page.transition_time
        }
      end
    end

    def self.build_definitions(model)
      model.definitions.reject(&:image?).map do |defn|
        {
          name:           defn.name,
          description:    defn.description,
          is_internal:    defn.internal?,
          instance_count: defn.instances.length,
          bounding_box: {
            width_m:  (defn.bounds.width  * Constants::IN_TO_M).round(4),
            depth_m:  (defn.bounds.depth  * Constants::IN_TO_M).round(4),
            height_m: (defn.bounds.height * Constants::IN_TO_M).round(4)
          },
          attributes: Traversal.extract_dicts(defn)
        }
      end
    end

  end
end
