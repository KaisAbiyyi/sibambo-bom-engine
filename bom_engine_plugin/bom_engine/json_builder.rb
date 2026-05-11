# bom_engine/json_builder.rb
# Assembles the final JSON payload from all collected data.

module BOMEngine
  module JSONBuilder

    SCHEMA_VERSION = "2.0"

    # Build the complete export hash.
    #
    # @param model     [Sketchup::Model]
    # @param entities  [Array<Hash>]
    # @param materials [Array<Hash>]
    # @param spatial   [Hash]
    # @param settings  [Hash]
    # @return          [Hash]
    def self.build(model:, entities:, materials:, spatial:, settings:)
      opts = model.options

      {
        schema_version: SCHEMA_VERSION,
        exported_at:    Time.now.utc.iso8601,
        software:       "SketchUp #{Sketchup.version}",
        plugin_version: BOMEngine::PLUGIN_VERSION,

        metadata: {
          name:                   model.name,
          description:            model.description,
          filepath:               model.path,
          guid:                   model.guid,
          attribute_dictionaries: Traversal.extract_dicts(model)
        },

        units: {
          length_unit_id:   opts["UnitsOptions"]["LengthUnit"],
          length_unit_name: unit_name(opts["UnitsOptions"]["LengthUnit"]),
          precision:        opts["UnitsOptions"]["LengthPrecision"],
          angle_unit:       opts["UnitsOptions"]["AngleUnits"] == 0 ? "degrees" : "radians",
          output_unit:      "meters"
        },

        shadow_settings:        build_shadow(model),
        tags:                   build_tags(model),
        scenes:                 build_scenes(model),
        component_definitions:  build_definitions(model),
        materials:              settings[:include_materials] == false ? [] : materials,
        spatial_analysis:       spatial,
        entities:               entities
      }
    end

    private

    UNIT_NAMES = %w[Inches Feet Millimeters Centimeters Meters Kilometers].freeze

    def self.unit_name(id)
      UNIT_NAMES[id.to_i] || "Unknown"
    end

    def self.build_shadow(model)
      si = model.shadow_info
      {
        shadows_enabled:      si["DisplayShadows"],
        use_sun_for_shading:  si["UseSunForAllShading"],
        light_intensity:      si["Light"],
        dark_intensity:       si["Dark"]
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
