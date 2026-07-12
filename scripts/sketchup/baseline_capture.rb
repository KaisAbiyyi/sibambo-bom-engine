# frozen_string_literal: true

# Loaded from SketchUp's Ruby Console by the end-to-end QA workflow.
# Captures read-only model inventory, deterministic camera views, screenshots,
# and timing data without saving the source SKP.

require "json"
require "fileutils"
require "time"

module BOMWorkflow
  module BaselineCapture
    %i[ROOT IN_TO_M STANDARD_VIEWS UNIT_NAMES ENTITY_KEYS].each do |name|
      remove_const(name) if const_defined?(name, false)
    end

    ROOT = "D:/projects/sibambo-bom-engine"
    IN_TO_M = 0.0254
    STANDARD_VIEWS = {
      "isometric" => [[1.0, -1.0, 0.8], [0.0, 0.0, 1.0]],
      "front" => [[0.0, -1.0, 0.0], [0.0, 0.0, 1.0]],
      "back" => [[0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
      "left" => [[1.0, 0.0, 0.0], [0.0, 0.0, 1.0]],
      "right" => [[-1.0, 0.0, 0.0], [0.0, 0.0, 1.0]],
      "top" => [[0.0, 0.0, 1.0], [0.0, 1.0, 0.0]]
    }.freeze
    UNIT_NAMES = %w[Inches Feet Millimeters Centimeters Meters Kilometers].freeze
    ENTITY_KEYS = %i[
      face edge group component_instance image construction_line text dimension other
    ].freeze

    def self.capture(slug)
      started = monotonic_time
      model = Sketchup.active_model
      raise "No active SketchUp model" unless model
      raise "Active model has not been saved" if model.path.to_s.empty?

      output_dir = File.join(ROOT, "artifacts", slug, "sketchup")
      metrics_dir = File.join(ROOT, "artifacts", slug, "metrics")
      log_dir = File.join(ROOT, "artifacts", slug, "logs")
      [output_dir, metrics_dir, log_dir].each { |path| FileUtils.mkdir_p(path) }

      view = model.active_view
      original_camera = copy_camera(view.camera)
      view.zoom_extents
      view.refresh

      inventory = build_inventory(model)
      captures = []
      STANDARD_VIEWS.each do |name, (direction, up)|
        captures << capture_standard_view(model, output_dir, name, direction, up)
      end
      captures.concat(capture_scene_views(model, output_dir))

      view.camera = original_camera
      view.refresh

      result = {
        workflow_version: "1.0.0",
        captured_at: Time.now.utc.iso8601,
        capture_elapsed_ms: ((monotonic_time - started) * 1000.0).round(2),
        model: inventory,
        captures: captures,
        warnings: inventory[:warnings]
      }
      path = File.join(metrics_dir, "baseline-sketchup.json")
      File.write(path, JSON.pretty_generate(result), mode: "w:UTF-8")
      File.write(
        File.join(log_dir, "baseline-sketchup.log"),
        "#{Time.now.utc.iso8601} capture_ok #{model.path} #{captures.length} views\n",
        mode: "a:UTF-8"
      )
      puts "BOM_WORKFLOW_CAPTURE_OK #{path}"
      path
    rescue StandardError => error
      write_error_log(slug, "capture", error)
      warn "BOM_WORKFLOW_CAPTURE_ERROR #{error.class}: #{error.message}"
      raise
    end

    def self.export_current(slug, level:, compress:)
      model = Sketchup.active_model
      raise "No active SketchUp model" unless model
      raise "BOM Engine plugin is not loaded" unless defined?(BOMEngine::Core)

      export_dir = File.join(ROOT, "artifacts", slug, "exported")
      metrics_dir = File.join(ROOT, "artifacts", slug, "metrics")
      FileUtils.mkdir_p(export_dir)
      FileUtils.mkdir_p(metrics_dir)
      base_path = File.join(export_dir, "baseline-current.json")
      started = monotonic_time
      status = "ok"
      error_text = nil
      log_messages = []
      logger = BOMEngine::Logger
      original_info = logger.method(:info)
      logger.define_singleton_method(:info) do |message|
        log_messages << message.to_s
        original_info.call(message)
      end

      begin
        BOMEngine::Core.run_export(
          output_path: base_path,
          export_level: level,
          export_textures: false,
          include_edges: false,
          include_materials: true,
          pretty_print: false,
          compress_output: compress,
          compact_geometry: level != "full",
          binary_geometry: level != "full",
          selection_only: false
        )
      rescue StandardError => error
        status = "error"
        error_text = "#{error.class}: #{error.message}"
        raise
      ensure
        logger.define_singleton_method(:info, original_info)
        elapsed_ms = ((monotonic_time - started) * 1000.0).round(2)
        completion_message = log_messages.reverse.find { |message| message.include?("Export complete in") }
        plugin_elapsed_s = completion_message&.match(/Export complete in ([0-9.]+)s/)&.captures&.first&.to_f
        extension = level == "full" ? "json" : "bome"
        output_path = File.join(export_dir, "baseline-current_#{level}.#{extension}")
        output_path += ".gz" if compress
        payload = {
          workflow_version: "1.0.0",
          measured_at: Time.now.utc.iso8601,
          source_skp: model.path,
          level: level,
          compressed: compress,
          status: status,
          wall_elapsed_ms_including_dialog: elapsed_ms,
          plugin_elapsed_ms: plugin_elapsed_s && (plugin_elapsed_s * 1000.0).round(2),
          output_path: output_path,
          output_exists: File.file?(output_path),
          output_bytes: File.file?(output_path) ? File.size(output_path) : nil,
          error: error_text
        }
        metrics_path = File.join(metrics_dir, "baseline-export-#{level}.json")
        File.write(metrics_path, JSON.pretty_generate(payload), mode: "w:UTF-8")
        puts "BOM_WORKFLOW_EXPORT_#{status.upcase} #{metrics_path}"
      end
    end

    def self.build_inventory(model)
      options = model.options["UnitsOptions"]
      counts = ENTITY_KEYS.to_h { |key| [key, 0] }
      walk_entities(model.entities, counts, [], 0)
      missing_assets = model.materials.filter_map do |material|
        next unless material.texture

        filename = material.texture.filename.to_s
        next if filename.empty? || File.file?(filename)

        { material: material.display_name, source: filename }
      rescue StandardError
        nil
      end
      warnings = []
      warnings << "Model has no scenes" if model.pages.length.zero?
      warnings << "Model has no materials" if model.materials.length.zero?
      warnings << "Texture source paths unavailable on disk; textures may still be embedded" unless missing_assets.empty?

      {
        source_path: model.path,
        source_bytes: File.file?(model.path) ? File.size(model.path) : nil,
        name: model.name,
        title: model.title,
        description: model.description,
        guid: model.guid,
        sketchup_version: Sketchup.version,
        sketchup_locale: Sketchup.get_locale,
        modified: model.modified?,
        units: {
          length_unit_id: options["LengthUnit"],
          length_unit_name: UNIT_NAMES[options["LengthUnit"].to_i] || "Unknown",
          length_precision: options["LengthPrecision"],
          length_format: options["LengthFormat"],
          suppress_units_display: options["SuppressUnitsDisplay"]
        },
        bounds: bounds_hash(model.bounds),
        axes: axes_hash(model),
        entity_counts_expanded: counts,
        top_level_entity_count: model.entities.length,
        definitions: model.definitions.reject(&:image?).map { |definition| definition_hash(definition) },
        definition_count: model.definitions.reject(&:image?).length,
        component_instance_count: model.definitions.sum { |definition| definition.instances.length },
        tags: model.layers.map { |layer| layer_hash(layer) },
        tag_count: model.layers.length,
        materials: model.materials.map { |material| material_hash(material) },
        material_count: model.materials.length,
        scenes: model.pages.map { |page| page_hash(page) },
        scene_count: model.pages.length,
        style: style_hash(model),
        georeferenced: model.georeferenced?,
        missing_assets: missing_assets,
        warnings: warnings
      }
    end

    def self.walk_entities(entities, counts, definition_stack, depth)
      raise "Entity hierarchy exceeds 64 levels" if depth > 64

      entities.each do |entity|
        case entity
        when Sketchup::Face
          counts[:face] += 1
        when Sketchup::Edge
          counts[:edge] += 1
        when Sketchup::Group
          counts[:group] += 1
          definition = entity.definition
          next if definition_stack.include?(definition.persistent_id)

          walk_entities(entity.entities, counts, definition_stack + [definition.persistent_id], depth + 1)
        when Sketchup::ComponentInstance
          counts[:component_instance] += 1
          definition = entity.definition
          next if definition_stack.include?(definition.persistent_id)

          walk_entities(definition.entities, counts, definition_stack + [definition.persistent_id], depth + 1)
        when Sketchup::Image
          counts[:image] += 1
        when Sketchup::ConstructionLine
          counts[:construction_line] += 1
        when Sketchup::Text
          counts[:text] += 1
        when Sketchup::Dimension
          counts[:dimension] += 1
        else
          counts[:other] += 1
        end
      end
    end

    def self.capture_standard_view(model, output_dir, name, direction_values, up_values)
      bounds = model.bounds
      center = bounds.center
      diagonal = [bounds.diagonal, 1.0].max
      direction = Geom::Vector3d.new(*direction_values).normalize
      up = Geom::Vector3d.new(*up_values).normalize
      eye = center.offset(direction, diagonal * 2.5)
      camera = Sketchup::Camera.new(eye, center, up)
      camera.perspective = false
      model.active_view.camera = camera
      model.active_view.zoom_extents
      model.active_view.refresh
      write_capture(model, output_dir, name, "standard")
    end

    def self.capture_scene_views(model, output_dir)
      model.pages.first(20).map.with_index do |page, index|
        model.active_view.camera = copy_camera(page.camera)
        model.active_view.refresh
        safe_name = page.name.to_s.gsub(/[^A-Za-z0-9._-]+/, "-").gsub(/^-|-$/, "")
        safe_name = "scene-#{index + 1}" if safe_name.empty?
        write_capture(model, output_dir, "scene-#{index + 1}-#{safe_name}", "scene", page.name)
      end
    end

    def self.write_capture(model, output_dir, name, source, scene_name = nil)
      view = model.active_view
      width = [[view.vpwidth, 320].max, 4096].min
      height = [[view.vpheight, 240].max, 4096].min
      image_path = File.join(output_dir, "#{name}.png")
      written = view.write_image(
        filename: image_path,
        width: width,
        height: height,
        antialias: true,
        compression: 0.9,
        transparent: false
      )
      raise "Failed to write #{image_path}" unless written

      camera = view.camera
      {
        model_name: model.title,
        view_name: name,
        source: source,
        scene_name: scene_name,
        image_path: image_path,
        projection_mode: camera.perspective? ? "perspective" : "orthographic",
        camera_position_m: point_hash(camera.eye),
        camera_target_m: point_hash(camera.target),
        camera_up: vector_hash(camera.up),
        field_of_view_degrees: camera.perspective? ? camera.fov : nil,
        orthographic_height_m: camera.perspective? ? nil : (camera.height * IN_TO_M).round(6),
        # SketchUp reports 0.0 when camera follows viewport aspect ratio.
        aspect_ratio: camera.aspect_ratio.to_f.positive? ? camera.aspect_ratio : (width.to_f / height),
        viewport: { width: width, height: height },
        hidden_geometry: rendering_option(model, "DrawHidden"),
        hidden_objects: rendering_option(model, "DrawHiddenGeometry"),
        edge_display_mode: rendering_option(model, "EdgeDisplayMode"),
        style_name: model.styles.selected_style&.name,
        timestamp: Time.now.utc.iso8601
      }
    end

    def self.copy_camera(camera)
      copy = Sketchup::Camera.new(camera.eye, camera.target, camera.up)
      copy.perspective = camera.perspective?
      if camera.perspective?
        copy.fov = camera.fov
      else
        copy.height = camera.height
      end
      copy.aspect_ratio = camera.aspect_ratio if camera.aspect_ratio.to_f.positive?
      copy
    end

    def self.definition_hash(definition)
      {
        persistent_id: definition.persistent_id,
        name: definition.name,
        description: definition.description,
        internal: definition.internal?,
        group: definition.group?,
        instance_count: definition.instances.length,
        entity_count: definition.entities.length,
        bounds: bounds_hash(definition.bounds)
      }
    rescue StandardError => error
      { name: definition.name, error: "#{error.class}: #{error.message}" }
    end

    def self.layer_hash(layer)
      {
        persistent_id: layer.persistent_id,
        name: layer.name,
        visible: layer.visible?,
        color: color_hash(layer.color)
      }
    end

    def self.material_hash(material)
      texture = material.texture
      {
        persistent_id: material.persistent_id,
        name: material.name,
        display_name: material.display_name,
        color: color_hash(material.color),
        alpha: material.alpha,
        texture: texture && {
          filename: texture.filename,
          width_m: (texture.width * IN_TO_M).round(6),
          height_m: (texture.height * IN_TO_M).round(6),
          image_width: texture.image_width,
          image_height: texture.image_height
        }
      }
    rescue StandardError => error
      { name: material.name, error: "#{error.class}: #{error.message}" }
    end

    def self.page_hash(page)
      {
        name: page.name,
        description: page.description,
        use_camera: page.use_camera?,
        transition_time: page.transition_time,
        camera: camera_hash(page.camera)
      }
    rescue StandardError => error
      { name: page.name, error: "#{error.class}: #{error.message}" }
    end

    def self.camera_hash(camera)
      {
        projection_mode: camera.perspective? ? "perspective" : "orthographic",
        eye_m: point_hash(camera.eye),
        target_m: point_hash(camera.target),
        up: vector_hash(camera.up),
        fov_degrees: camera.perspective? ? camera.fov : nil,
        orthographic_height_m: camera.perspective? ? nil : (camera.height * IN_TO_M).round(6),
        aspect_ratio: camera.aspect_ratio
      }
    end

    def self.axes_hash(model)
      axes = model.axes
      {
        origin_m: point_hash(axes.origin),
        x_axis: vector_hash(axes.xaxis),
        y_axis: vector_hash(axes.yaxis),
        z_axis: vector_hash(axes.zaxis)
      }
    rescue StandardError => error
      { error: "#{error.class}: #{error.message}" }
    end

    def self.style_hash(model)
      rendering = model.rendering_options
      {
        selected_style: model.styles.selected_style&.name,
        display_sketch_axes: rendering["DisplaySketchAxes"],
        draw_hidden: rendering["DrawHidden"],
        draw_hidden_geometry: rendering["DrawHiddenGeometry"],
        edge_display_mode: rendering["EdgeDisplayMode"],
        face_front_color: color_hash(rendering["FaceFrontColor"]),
        face_back_color: color_hash(rendering["FaceBackColor"]),
        background_color: color_hash(rendering["BackgroundColor"])
      }
    rescue StandardError => error
      { error: "#{error.class}: #{error.message}" }
    end

    def self.bounds_hash(bounds)
      {
        min_m: point_hash(bounds.min),
        max_m: point_hash(bounds.max),
        size_m: {
          x: (bounds.width * IN_TO_M).round(6),
          y: (bounds.height * IN_TO_M).round(6),
          z: (bounds.depth * IN_TO_M).round(6)
        },
        width_m: (bounds.width * IN_TO_M).round(6),
        depth_m: (bounds.height * IN_TO_M).round(6),
        height_m: (bounds.depth * IN_TO_M).round(6),
        diagonal_m: (bounds.diagonal * IN_TO_M).round(6)
      }
    end

    def self.point_hash(point)
      {
        x: (point.x * IN_TO_M).round(6),
        y: (point.y * IN_TO_M).round(6),
        z: (point.z * IN_TO_M).round(6)
      }
    end

    def self.vector_hash(vector)
      { x: vector.x.round(8), y: vector.y.round(8), z: vector.z.round(8) }
    end

    def self.color_hash(color)
      return nil unless color.respond_to?(:red)

      {
        red: color.red,
        green: color.green,
        blue: color.blue,
        alpha: color.respond_to?(:alpha) ? color.alpha : 255,
        hex: format("#%02X%02X%02X", color.red, color.green, color.blue)
      }
    end

    def self.rendering_option(model, key)
      model.rendering_options[key]
    rescue StandardError
      nil
    end

    def self.monotonic_time
      Process.clock_gettime(Process::CLOCK_MONOTONIC)
    end

    def self.write_error_log(slug, phase, error)
      directory = File.join(ROOT, "artifacts", slug, "logs")
      FileUtils.mkdir_p(directory)
      File.write(
        File.join(directory, "baseline-errors.log"),
        "#{Time.now.utc.iso8601} #{phase} #{error.class}: #{error.message}\n#{error.backtrace&.join("\n")}\n",
        mode: "a:UTF-8"
      )
    rescue StandardError
      nil
    end
  end
end
