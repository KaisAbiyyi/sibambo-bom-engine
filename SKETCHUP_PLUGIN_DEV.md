# SketchUp BOM Engine Plugin — Implementation Guide

> **Version:** 2.0  
> **Target:** SketchUp 2019–2024 (Ruby API 2.x)  
> **Purpose:** Full extraction of geometric data, metadata, and spatial analysis from `.skp` models to structured JSON for BOM Engine consumption

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Project Structure](#2-project-structure)
3. [Environment Setup](#3-environment-setup)
4. [Core Modules](#4-core-modules)
   - 4.1 [Entry Point & Menu Registration](#41-entry-point--menu-registration)
   - 4.2 [Entity Traversal Engine](#42-entity-traversal-engine)
   - 4.3 [Surface Classifier](#43-surface-classifier)
   - 4.4 [Opening Detector](#44-opening-detector)
   - 4.5 [Material Extractor](#45-material-extractor)
   - 4.6 [Spatial Analyzer](#46-spatial-analyzer)
   - 4.7 [JSON Serializer](#47-json-serializer)
   - 4.8 [Texture Exporter](#48-texture-exporter)
5. [UI: Export Dialog](#5-ui-export-dialog)
6. [Observer System (Real-Time Mode)](#6-observer-system-real-time-mode)
7. [Error Handling & Logging](#7-error-handling--logging)
8. [JSON Schema Reference](#8-json-schema-reference)
9. [Testing & Validation](#9-testing--validation)
10. [Packaging as `.rbz`](#10-packaging-as-rbz)
11. [Known Limitations & Workarounds](#11-known-limitations--workarounds)
12. [Changelog](#12-changelog)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    PLUGIN ENTRY POINT                    │
│                  bom_engine_loader.rb                    │
│         (registers menu, toolbar, keyboard shortcut)     │
└──────────────────────┬──────────────────────────────────┘
                       │ triggers
┌──────────────────────▼──────────────────────────────────┐
│                    EXPORT CONTROLLER                     │
│                   bom_engine_core.rb                     │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Traversal  │  │  Classifier  │  │   Analyzer    │  │
│  │   Engine    │  │  (surfaces,  │  │  (spatial,    │  │
│  │             │  │   openings)  │  │   metadata)   │  │
│  └──────┬──────┘  └──────┬───────┘  └───────┬───────┘  │
│         └────────────────┴──────────────────┘           │
│                          │ feeds                         │
│                 ┌────────▼────────┐                      │
│                 │  JSON Builder   │                      │
│                 └────────┬────────┘                      │
└──────────────────────────┼──────────────────────────────┘
                           │ writes
              ┌────────────▼────────────┐
              │   house_model.json      │
              │   /textures/*.png       │
              └─────────────────────────┘
```

**Data flow principle:**
- All coordinates are converted from SketchUp inches → meters (`× 0.0254`)
- Transformations are composed recursively — all output is **world-space absolute**
- Face normals are transformed via inverse-transpose of the transformation matrix
- Component instances reference their definition by name; geometry is fully inlined in output

---

## 2. Project Structure

```
bom_engine_plugin/
│
├── bom_engine_loader.rb          # Entry point, auto-loaded by SketchUp
│
├── bom_engine/
│   ├── core.rb                   # Export controller, orchestrates modules
│   ├── traversal.rb              # Recursive entity tree walker
│   ├── classifier.rb             # Surface type classification (wall/floor/ceiling)
│   ├── opening_detector.rb       # Door/window detection from face inner loops
│   ├── material_extractor.rb     # Material + texture data extraction
│   ├── spatial_analyzer.rb       # Aggregate spatial metrics
│   ├── json_builder.rb           # JSON serialization & schema assembly
│   ├── texture_exporter.rb       # Bitmap texture write-out
│   ├── observer.rb               # Real-time change observer (optional mode)
│   ├── ui_dialog.rb              # HtmlDialog export settings UI
│   ├── logger.rb                 # Structured logging to Ruby Console
│   └── constants.rb              # Shared constants (conversion factors, thresholds)
│
├── ui/
│   ├── export_dialog.html        # Export dialog HTML/CSS/JS
│   └── toolbar_icon.png          # Toolbar button icon (24×24 px)
│
└── tests/
    ├── test_classifier.rb        # Unit tests for surface classification
    ├── test_traversal.rb         # Unit tests for entity traversal
    └── test_spatial.rb           # Unit tests for spatial analysis
```

---

## 3. Environment Setup

### 3.1 Development Requirements

| Tool | Version | Purpose |
|------|---------|---------|
| SketchUp Pro / Studio | 2019–2024 | Runtime environment |
| Ruby | 2.7 (bundled) | Plugin language |
| VS Code + Ruby extension | Latest | Code editing |
| SketchUp Ruby API Stubs | Latest | Autocomplete |

### 3.2 Install API Stubs for Autocomplete

```bash
# In your project directory
gem install sketchup-api-stubs
```

Add to `.vscode/settings.json`:
```json
{
  "ruby.intellisense": "rubyLocate",
  "solargraph.diagnostics": true,
  "solargraph.references": true
}
```

### 3.3 Plugin Installation Path

```
# Windows
C:\Users\{username}\AppData\Roaming\SketchUp\SketchUp 20xx\SketchUp\Plugins\

# macOS
~/Library/Application Support/SketchUp 20xx/SketchUp/Plugins/

# Development: symlink for hot-reload
# Windows PowerShell (run as admin):
New-Item -ItemType SymbolicLink `
  -Path "C:\...\Plugins\bom_engine_plugin" `
  -Target "C:\dev\bom_engine_plugin"
```

### 3.4 Ruby Console Quick Commands

```ruby
# Reload plugin during development (in SketchUp Ruby Console)
load File.join(Sketchup.find_support_file("Plugins"), "bom_engine_loader.rb")

# Inspect current model
model = Sketchup.active_model
puts model.entities.length
puts model.materials.length

# Test a specific module
load "C:/dev/bom_engine_plugin/bom_engine/classifier.rb"
```

---

## 4. Core Modules

### 4.1 Entry Point & Menu Registration

```ruby
# bom_engine_loader.rb

require 'sketchup'
require 'extensions'

module BOMEngine
  PLUGIN_VERSION = "2.0.0"
  PLUGIN_PATH    = File.dirname(__FILE__)

  # Register as SketchUp Extension (enables/disables via Preferences > Extensions)
  extension = SketchupExtension.new(
    "BOM Engine Exporter",
    File.join(PLUGIN_PATH, "bom_engine", "core.rb")
  )
  extension.description = "Exports SketchUp model geometry and metadata to " \
                          "structured JSON for BOM cost estimation."
  extension.version     = PLUGIN_VERSION
  extension.creator     = "[Your Name / Institution]"
  extension.copyright   = "© 2026 [Your Institution]"

  Sketchup.register_extension(extension, true)
end
```

```ruby
# bom_engine/core.rb

require_relative 'constants'
require_relative 'logger'
require_relative 'traversal'
require_relative 'classifier'
require_relative 'opening_detector'
require_relative 'material_extractor'
require_relative 'spatial_analyzer'
require_relative 'json_builder'
require_relative 'texture_exporter'
require_relative 'ui_dialog'
require 'json'

module BOMEngine
  module Core

    # ── Register menu items ──────────────────────────────────────
    unless file_loaded?(__FILE__)
      plugins_menu = UI.menu("Plugins")
      bom_menu     = plugins_menu.add_submenu("BOM Engine")

      bom_menu.add_item("Export Model to JSON...") { export_with_dialog }
      bom_menu.add_item("Quick Export (last settings)") { quick_export }
      bom_menu.add_separator
      bom_menu.add_item("Toggle Real-Time Observer") { toggle_observer }
      bom_menu.add_separator
      bom_menu.add_item("About BOM Engine") { show_about }

      # Toolbar
      toolbar = UI::Toolbar.new("BOM Engine")
      cmd = UI::Command.new("Export JSON") { export_with_dialog }
      cmd.small_icon = File.join(BOMEngine::PLUGIN_PATH, "ui", "toolbar_icon.png")
      cmd.large_icon = File.join(BOMEngine::PLUGIN_PATH, "ui", "toolbar_icon.png")
      cmd.tooltip    = "BOM Engine: Export model to JSON"
      cmd.status_bar_text = "Export SketchUp model to BOM Engine JSON"
      toolbar.add_item(cmd)
      toolbar.restore

      file_loaded(__FILE__)
    end

    # ── Main export entry ────────────────────────────────────────
    def self.export_with_dialog
      model = Sketchup.active_model
      if model.nil? || model.path.empty?
        UI.messagebox("Please save the model before exporting.", MB_OK)
        return
      end
      UIDialog.show { |settings| run_export(settings) }
    end

    def self.quick_export
      last = load_last_settings
      return export_with_dialog if last.nil?
      run_export(last)
    end

    def self.run_export(settings)
      model      = Sketchup.active_model
      out_path   = settings[:output_path]
      tex_dir    = settings[:export_textures] ? out_path.gsub(".json", "_textures") : nil

      BOMEngine::Logger.info("Export started: #{out_path}")
      start_time = Time.now

      model.start_operation("BOM Engine Export", true)

      begin
        # Phase 1: texture writer instance (needed for UV extraction)
        tw = Sketchup::TextureWriter.new

        # Phase 2: collect materials
        materials = MaterialExtractor.extract(model, tw, tex_dir)

        # Phase 3: walk entity tree
        identity = Geom::Transformation.new
        entities = Traversal.walk(model.entities, tw, identity)

        # Phase 4: spatial analysis
        spatial  = SpatialAnalyzer.analyze(model)

        # Phase 5: assemble JSON
        payload = JSONBuilder.build(
          model:     model,
          entities:  entities,
          materials: materials,
          spatial:   spatial,
          settings:  settings
        )

        # Phase 6: write textures if requested
        TextureExporter.write_all(tw, tex_dir) if settings[:export_textures]

        # Phase 7: write JSON
        File.write(out_path, JSON.pretty_generate(payload), encoding: 'UTF-8')

        elapsed = (Time.now - start_time).round(2)
        BOMEngine::Logger.info("Export complete in #{elapsed}s → #{out_path}")
        UI.messagebox(
          "Export complete!\n\nFile: #{out_path}\n" \
          "Entities: #{entities.length}\n" \
          "Time: #{elapsed}s",
          MB_OK
        )

        save_last_settings(settings)

      rescue => e
        model.abort_operation
        BOMEngine::Logger.error("Export failed: #{e.message}\n#{e.backtrace.first(5).join("\n")}")
        UI.messagebox("Export failed:\n#{e.message}", MB_OK)
        return
      end

      model.commit_operation
    end

    # ── Observer toggle ──────────────────────────────────────────
    def self.toggle_observer
      @observer_active = !@observer_active
      if @observer_active
        @model_observer = BOMObserver.new
        Sketchup.active_model.add_observer(@model_observer)
        UI.messagebox("Real-Time Observer: ON\nBOM will update on every model change.", MB_OK)
      else
        Sketchup.active_model.remove_observer(@model_observer)
        @model_observer = nil
        UI.messagebox("Real-Time Observer: OFF", MB_OK)
      end
    end

    # ── Persistence helpers ──────────────────────────────────────
    SETTINGS_KEY = "BOMEngine_LastSettings"

    def self.save_last_settings(settings)
      Sketchup.write_default(SETTINGS_KEY, "output_path", settings[:output_path])
      Sketchup.write_default(SETTINGS_KEY, "export_textures", settings[:export_textures].to_s)
      Sketchup.write_default(SETTINGS_KEY, "include_edges", settings[:include_edges].to_s)
    end

    def self.load_last_settings
      path = Sketchup.read_default(SETTINGS_KEY, "output_path")
      return nil if path.nil? || path.empty?
      {
        output_path:      path,
        export_textures:  Sketchup.read_default(SETTINGS_KEY, "export_textures") == "true",
        include_edges:    Sketchup.read_default(SETTINGS_KEY, "include_edges")   == "true",
      }
    end

    def self.show_about
      UI.messagebox(
        "BOM Engine Exporter v#{BOMEngine::PLUGIN_VERSION}\n\n" \
        "Exports SketchUp models to structured JSON\n" \
        "for component-level construction cost estimation\n" \
        "using SNI-AHSP coefficients.\n\n" \
        "Research project — [Institution Name] 2026",
        MB_OK
      )
    end

  end
end
```

---

### 4.2 Entity Traversal Engine

```ruby
# bom_engine/traversal.rb

module BOMEngine
  module Traversal

    # Walk the full entity tree recursively.
    # Returns flat array of entity hashes with world-space coordinates.
    #
    # @param entities   [Sketchup::Entities]
    # @param tw         [Sketchup::TextureWriter]
    # @param parent_tf  [Geom::Transformation] accumulated world transform
    # @param depth      [Integer] recursion depth (for logging, max guard)
    # @return           [Array<Hash>]
    def self.walk(entities, tw, parent_tf, depth = 0)
      result = []

      # Safety guard against infinite recursion on malformed models
      if depth > Constants::MAX_RECURSION_DEPTH
        Logger.warn("Max recursion depth #{Constants::MAX_RECURSION_DEPTH} reached. Skipping subtree.")
        return result
      end

      entities.each do |entity|
        next if entity.nil? || entity.deleted?

        case entity
        when Sketchup::Face
          result << build_face(entity, tw, parent_tf)

        when Sketchup::Edge
          # Edges are expensive — only include if settings say so
          result << build_edge(entity, parent_tf) if Constants::INCLUDE_EDGES

        when Sketchup::Group
          child_tf = parent_tf * entity.transformation
          result << {
            type:        "Group",
            id:          entity.persistent_id.to_s,
            name:        entity.name || "",
            layer:       safe_layer_name(entity),
            guid:        entity.guid,
            transform:   entity.transformation.to_a,
            bounding_box: bbox_hash(entity.bounds, parent_tf),
            attributes:  extract_dicts(entity),
            children:    walk(entity.entities, tw, child_tf, depth + 1)
          }

        when Sketchup::ComponentInstance
          defn     = entity.definition
          child_tf = parent_tf * entity.transformation
          result << {
            type:              "ComponentInstance",
            id:                entity.persistent_id.to_s,
            name:              entity.name || "",
            definition_name:   defn.name,
            layer:             safe_layer_name(entity),
            guid:              entity.guid,
            transform:         entity.transformation.to_a,
            world_center:      pt_to_m(child_tf * defn.bounds.center),
            bounding_box:      bbox_hash(entity.bounds, parent_tf),
            dynamic_attributes: extract_dynamic_attrs(entity),
            attributes:        extract_dicts(entity),
            children:          walk(defn.entities, tw, child_tf, depth + 1)
          }

        when Sketchup::Image
          result << build_image(entity, parent_tf)

        when Sketchup::Text
          next if entity.point.nil?
          result << {
            type:     "Text",
            text:     entity.text,
            position: pt_to_m(parent_tf * entity.point)
          }

        when Sketchup::ConstructionLine
          result << {
            type:  "ConstructionLine",
            start: pt_to_m(parent_tf * entity.start),
            end:   pt_to_m(parent_tf * entity.end)
          } if Constants::INCLUDE_CONSTRUCTION_LINES

        end
      end

      result
    end

    # ── Face builder ─────────────────────────────────────────────
    def self.build_face(face, tw, tf)
      # Transform normal: use inverse-transpose for correct normal transformation
      normal_world = (tf.inverse.transpose * face.normal).normalize

      # Classify surface type
      surface_type = Classifier.classify(normal_world)

      # Get UV helper for texture coordinates
      uv_helper = face.get_UVHelper(true, true, tw) rescue nil

      # Build outer loop vertices with UV
      outer_vertices = face.outer_loop.vertices.map do |v|
        world_pt = tf * v.position
        uv = extract_uv(uv_helper, v.position)
        { position: pt_to_m(world_pt), uv: uv }
      end

      # Build inner loops (holes = openings)
      holes = face.loops.reject(&:outer?).map do |loop|
        loop.vertices.map { |v| pt_to_m(tf * v.position) }
      end

      # Area in m²
      area_m2 = (face.area * Constants::IN2_TO_M2).round(4)

      # Material data
      mat_front = material_hash(face.material)
      mat_back  = material_hash(face.back_material)

      {
        type:          "Face",
        id:            face.persistent_id.to_s,
        layer:         safe_layer_name(face),
        surface_type:  surface_type,
        vertices:      outer_vertices,
        holes:         holes,
        has_holes:     !holes.empty?,
        normal:        vec_hash(normal_world),
        area_m2:       area_m2,
        material_front: mat_front,
        material_back:  mat_back,
        attributes:    extract_dicts(face)
      }
    end

    # ── Edge builder ─────────────────────────────────────────────
    def self.build_edge(edge, tf)
      {
        type:      "Edge",
        id:        edge.persistent_id.to_s,
        layer:     safe_layer_name(edge),
        start:     pt_to_m(tf * edge.start.position),
        end:       pt_to_m(tf * edge.end.position),
        length_m:  (edge.length * Constants::IN_TO_M).round(5),
        hidden:    edge.hidden?,
        soft:      edge.soft?,
        smooth:    edge.smooth?
      }
    end

    # ── Image entity builder ─────────────────────────────────────
    def self.build_image(img, tf)
      {
        type:      "ImageEntity",
        id:        img.persistent_id.to_s,
        filename:  img.filename,
        width_m:   (img.width  * Constants::IN_TO_M).round(4),
        height_m:  (img.height * Constants::IN_TO_M).round(4),
        position:  pt_to_m(tf * img.origin)
      }
    end

    # ── Helpers ──────────────────────────────────────────────────

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

    def self.material_hash(mat)
      return nil if mat.nil?
      c = mat.color
      h = {
        name:          mat.name,
        display_name:  mat.display_name,
        color:         { r: c.red, g: c.green, b: c.blue, a: c.alpha,
                         hex: "#%02x%02x%02x" % [c.red, c.green, c.blue] },
        alpha:         mat.alpha,
        material_type: mat.materialType,
        # Derived physical properties (estimated from color luminance)
        reflectance:   estimate_reflectance(c),
        acoustic_absorption: estimate_absorption(mat.name)
      }
      if mat.texture
        h[:texture] = {
          filename:   mat.texture.filename,
          width_m:    (mat.texture.width  * Constants::IN_TO_M).round(4),
          height_m:   (mat.texture.height * Constants::IN_TO_M).round(4),
          image_width_px:  mat.texture.image_width,
          image_height_px: mat.texture.image_height
        }
      end
      h
    end

    def self.estimate_reflectance(color)
      # Perceptual luminance (ITU-R BT.601)
      ((0.299 * color.red + 0.587 * color.green + 0.114 * color.blue) / 255.0).round(4)
    end

    # SNI-standard acoustic absorption coefficients at 500 Hz (Sabine)
    ABSORPTION_TABLE = {
      /bata|brick/          => 0.03,
      /beton|concrete/      => 0.02,
      /kayu|wood|parket/    => 0.10,
      /karpet|carpet/       => 0.35,
      /kaca|glass|jendela/  => 0.04,
      /tirai|curtain/       => 0.40,
      /plester|plaster/     => 0.04,
      /busa|foam/           => 0.70,
      /keramik|tile|ceramic/=> 0.02,
      /metal|besi|steel/    => 0.02,
      /kain|fabric|textile/ => 0.35,
      /cat|paint/           => 0.04,
      /granit|granite/      => 0.02,
    }.freeze

    def self.estimate_absorption(name)
      name_down = name.to_s.downcase
      ABSORPTION_TABLE.each { |pat, val| return val if name_down.match?(pat) }
      0.05  # default: hard surface
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
```

---

### 4.3 Surface Classifier

```ruby
# bom_engine/classifier.rb

module BOMEngine
  module Classifier

    # Classify a face by its world-space normal vector
    # Returns one of: "floor", "ceiling", "wall_x", "wall_y",
    #                 "roof_slope", "opening", "unknown"
    #
    # @param normal [Geom::Vector3d] world-space normalized normal
    # @return [String]
    def self.classify(normal)
      nz = normal.z
      nx = normal.x.abs
      ny = normal.y.abs

      # Horizontal surfaces
      if nz.abs > Constants::HORIZONTAL_THRESHOLD
        return nz > 0 ? "floor" : "ceiling"
      end

      # Near-vertical slopes (roof sections: 15° – 55° from horizontal)
      if nz.abs > 0.25 && nz.abs <= Constants::HORIZONTAL_THRESHOLD
        return "roof_slope"
      end

      # Vertical walls — dominant horizontal direction
      if nx >= ny
        normal.x > 0 ? "wall_x_pos" : "wall_x_neg"
      else
        normal.y > 0 ? "wall_y_pos" : "wall_y_neg"
      end
    end

    # Simplified 4-category version (for BOM mapping)
    def self.simplified(normal)
      full = classify(normal)
      case full
      when "floor"                          then "floor"
      when "ceiling"                        then "ceiling"
      when /^wall_/                         then "wall"
      when "roof_slope"                     then "ceiling"  # treat as ceiling for BOM
      else                                       "unknown"
      end
    end

    # Cardinal facade orientation for daylight analysis
    # Returns: "north", "south", "east", "west"
    # Assumes SketchUp green axis (Y+) = North (adjustable via model north angle)
    def self.facade_orientation(normal, north_angle_deg = 0.0)
      # Rotate normal by north angle correction
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
```

---

### 4.4 Opening Detector

```ruby
# bom_engine/opening_detector.rb

module BOMEngine
  module OpeningDetector

    # Detect openings from collected face data
    # Called after spatial analysis has accumulated all faces
    #
    # @param all_faces [Array<Hash>] face hashes from traversal
    # @return [Array<Hash>] opening descriptors
    def self.detect(all_faces)
      openings = []

      all_faces.each do |face|
        next if face[:holes].nil? || face[:holes].empty?

        face[:holes].each_with_index do |hole_verts, idx|
          next if hole_verts.length < 3

          # Calculate centroid
          cx = hole_verts.sum { |v| v[:x] } / hole_verts.length
          cy = hole_verts.sum { |v| v[:y] } / hole_verts.length
          cz = hole_verts.sum { |v| v[:z] } / hole_verts.length

          # Estimate area using shoelace formula projected onto dominant plane
          area = polygon_area(hole_verts, face[:normal])

          # Classify by height
          type = classify_opening_type(cz, area)

          # Facade orientation (for window solar analysis)
          orientation = nil
          if face[:surface_type] =~ /wall/
            normal = Geom::Vector3d.new(
              face[:normal][:x],
              face[:normal][:y],
              face[:normal][:z]
            )
            orientation = Classifier.facade_orientation(normal)
          end

          openings << {
            id:               "#{face[:id]}_hole_#{idx}",
            parent_face_id:   face[:id],
            opening_type:     type,
            surface_type:     face[:surface_type],
            normal:           face[:normal],
            centroid:         { x: cx.round(4), y: cy.round(4), z: cz.round(4) },
            estimated_area_m2: area.round(4),
            vertex_count:     hole_verts.length,
            facade_orientation: orientation,
            # For door dimension estimation
            height_estimate_m: estimate_height(hole_verts),
            width_estimate_m:  estimate_width(hole_verts)
          }
        end
      end

      openings
    end

    private

    # Shoelace formula for polygon area in 3D
    # Projects onto the plane defined by the face normal
    def self.polygon_area(verts, normal)
      return 0.0 if verts.length < 3
      area = 0.0
      n = verts.length
      n.times do |i|
        j = (i + 1) % n
        ax = verts[j][:x] - verts[0][:x]
        ay = verts[j][:y] - verts[0][:y]
        az = verts[j][:z] - verts[0][:z]
        bx = verts[i][:x] - verts[0][:x]
        by = verts[i][:y] - verts[0][:y]
        bz = verts[i][:z] - verts[0][:z]
        # Cross product magnitude
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
```

---

### 4.5 Material Extractor

```ruby
# bom_engine/material_extractor.rb

module BOMEngine
  module MaterialExtractor

    def self.extract(model, tw, texture_dir)
      model.materials.map do |mat|
        c = mat.color
        entry = {
          id:            mat.object_id.to_s,
          name:          mat.name,
          display_name:  mat.display_name,
          color:         { r: c.red, g: c.green, b: c.blue, a: c.alpha,
                           hex: "#%02x%02x%02x" % [c.red, c.green, c.blue] },
          alpha:         mat.alpha,
          material_type: mat.materialType,
          attributes:    Traversal.extract_dicts(mat)
        }

        if mat.texture && !texture_dir.nil?
          tex = mat.texture
          safe_name = mat.name.gsub(/[^\w\-]/, '_')
          tex_filename = "#{safe_name}.png"

          entry[:texture] = {
            filename:        tex_filename,
            source_path:     tex.filename,
            width_m:         (tex.width  * Constants::IN_TO_M).round(4),
            height_m:        (tex.height * Constants::IN_TO_M).round(4),
            image_width_px:  tex.image_width,
            image_height_px: tex.image_height
          }

          # Register for write — actual write happens later via TextureExporter
          begin
            tw.load(mat, true)
          rescue => e
            Logger.warn("Could not load texture for #{mat.name}: #{e.message}")
          end
        end

        entry
      end
    end

  end
end
```

---

### 4.6 Spatial Analyzer

```ruby
# bom_engine/spatial_analyzer.rb

module BOMEngine
  module SpatialAnalyzer

    def self.analyze(model)
      all_faces = collect_all_faces(model.entities, Geom::Transformation.new)
      openings  = OpeningDetector.detect(all_faces)
      bb        = model.bounds

      # Categorize by surface type
      floors   = all_faces.select { |f| f[:surface_type] == "floor" }
      ceilings = all_faces.select { |f| f[:surface_type] == "ceiling" }
      walls    = all_faces.select { |f| f[:surface_type] =~ /^wall/ }
      slopes   = all_faces.select { |f| f[:surface_type] == "roof_slope" }

      floor_area   = floors.sum  { |f| f[:area_m2] }
      ceiling_area = ceilings.sum { |f| f[:area_m2] }
      wall_area    = walls.sum   { |f| f[:area_m2] }
      slope_area   = slopes.sum  { |f| f[:area_m2] }

      # Net wall area (gross minus openings)
      opening_area = openings.sum { |o| o[:estimated_area_m2] }
      net_wall_area = [wall_area - opening_area, 0].max

      # Facade orientation breakdown
      facade_data = analyze_facades(walls, model.shadow_info)

      # Room detection (simple: connected floor components)
      rooms = detect_rooms(floors, walls)

      {
        bounding_box: bbox_world(bb),
        building_dimensions: {
          width_m:  ((bb.max.x - bb.min.x) * Constants::IN_TO_M).round(3),
          depth_m:  ((bb.max.y - bb.min.y) * Constants::IN_TO_M).round(3),
          height_m: ((bb.max.z - bb.min.z) * Constants::IN_TO_M).round(3)
        },
        surface_summary: {
          total_faces:          all_faces.length,
          floor_faces:          floors.length,
          ceiling_faces:        ceilings.length,
          wall_faces:           walls.length,
          roof_slope_faces:     slopes.length,
          total_floor_area_m2:  floor_area.round(3),
          total_ceiling_area_m2: ceiling_area.round(3),
          total_wall_area_m2:   wall_area.round(3),
          gross_wall_area_m2:   wall_area.round(3),
          net_wall_area_m2:     net_wall_area.round(3),
          total_opening_area_m2: opening_area.round(3),
          wall_to_floor_ratio:  floor_area > 0 ? (wall_area / floor_area).round(3) : 0,
          window_to_wall_ratio: wall_area  > 0 ? (opening_area / wall_area).round(3) : 0,
          roof_slope_area_m2:   slope_area.round(3)
        },
        openings:            openings,
        facade_orientations: facade_data,
        rooms:               rooms,
        estimated_volume_m3: estimate_volume(bb),
        geolocation:         extract_geolocation(model)
      }
    end

    private

    def self.collect_all_faces(entities, tf, result = [])
      entities.each do |e|
        case e
        when Sketchup::Face
          n = (tf.inverse.transpose * e.normal).normalize
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
      cx = pts.sum(&:x) / pts.length
      cy = pts.sum(&:y) / pts.length
      cz = pts.sum(&:z) / pts.length
      Geom::Point3d.new(cx, cy, cz)
    end

    def self.analyze_facades(wall_faces, shadow_info)
      north_angle = begin shadow_info["NorthAngle"] rescue 0.0 end
      counts = Hash.new(0)
      areas  = Hash.new(0.0)

      wall_faces.each do |f|
        n   = Geom::Vector3d.new(f[:normal][:x], f[:normal][:y], f[:normal][:z])
        dir = Classifier.facade_orientation(n, north_angle)
        counts[dir] += 1
        areas[dir]  += f[:area_m2]
      end

      {
        face_count: counts,
        area_m2:    areas.transform_values { |v| v.round(3) },
        north_angle_deg: north_angle
      }
    end

    # Simple room detection: group floor faces into clusters by proximity
    def self.detect_rooms(floor_faces, wall_faces)
      return [] if floor_faces.empty?

      rooms = []
      floor_faces.each_with_index do |floor, i|
        rooms << {
          room_id:     "room_#{i + 1}",
          floor_area_m2: floor[:area_m2],
          centroid:    floor[:centroid],
          # Estimated perimeter from bounding polygon (approximate)
          estimated_perimeter_m: nil  # TODO: implement proper room outline detection
        }
      end
      rooms
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
```

---

### 4.7 JSON Builder

```ruby
# bom_engine/json_builder.rb

module BOMEngine
  module JSONBuilder

    SCHEMA_VERSION = "2.0"

    def self.build(model:, entities:, materials:, spatial:, settings:)
      opts = model.options

      {
        schema_version:  SCHEMA_VERSION,
        exported_at:     Time.now.utc.iso8601,
        software:        "SketchUp #{Sketchup.version}",
        plugin_version:  BOMEngine::PLUGIN_VERSION,

        metadata: {
          name:        model.name,
          description: model.description,
          filepath:    model.path,
          guid:        model.guid,
          attribute_dictionaries: Traversal.extract_dicts(model)
        },

        units: {
          length_unit_id:   opts["UnitsOptions"]["LengthUnit"],
          length_unit_name: unit_name(opts["UnitsOptions"]["LengthUnit"]),
          precision:        opts["UnitsOptions"]["LengthPrecision"],
          angle_unit:       opts["UnitsOptions"]["AngleUnits"] == 0 ? "degrees" : "radians",
          output_unit:      "meters"  # always output in SI
        },

        shadow_settings: build_shadow(model),
        tags:            build_tags(model),
        scenes:          build_scenes(model),
        component_definitions: build_definitions(model),
        materials:       materials,
        spatial_analysis: spatial,
        entities:        entities
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
        shadows_enabled:    si["DisplayShadows"],
        use_sun_for_shading: si["UseSunForAllShading"],
        light_intensity:    si["Light"],
        dark_intensity:     si["Dark"]
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
          name:        page.name,
          description: page.description,
          camera: {
            eye:           Traversal.pt_to_m(cam.eye),
            target:        Traversal.pt_to_m(cam.target),
            up:            Traversal.vec_hash(cam.up),
            fov:           cam.fov,
            perspective:   cam.perspective?,
            aspect_ratio:  cam.aspect_ratio
          },
          use_camera:  page.use_camera?,
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
```

---

### 4.8 Texture Exporter

```ruby
# bom_engine/texture_exporter.rb

module BOMEngine
  module TextureExporter

    def self.write_all(tw, texture_dir)
      return if texture_dir.nil?

      Dir.mkdir(texture_dir) unless Dir.exist?(texture_dir)

      written = 0
      tw.count.times do |i|
        material = tw.get_material(i) rescue nil
        next unless material&.texture

        safe_name = material.name.gsub(/[^\w\-]/, '_')
        out_path  = File.join(texture_dir, "#{safe_name}.png")

        begin
          tw.write(material, true, out_path)
          written += 1
        rescue => e
          Logger.warn("Could not write texture #{safe_name}: #{e.message}")
        end
      end

      Logger.info("Wrote #{written} textures to #{texture_dir}")
    end

  end
end
```

---

### 4.9 Constants

```ruby
# bom_engine/constants.rb

module BOMEngine
  module Constants

    # Unit conversion
    IN_TO_M    = 0.0254
    IN2_TO_M2  = IN_TO_M ** 2
    IN3_TO_M3  = IN_TO_M ** 3

    # Surface classification thresholds
    HORIZONTAL_THRESHOLD = 0.85   # |nz| > 0.85 → floor or ceiling
    ROOF_SLOPE_MIN       = 0.25   # |nz| > 0.25 AND ≤ 0.85 → roof slope

    # Opening detection thresholds (in meters)
    DOOR_HEIGHT_THRESHOLD = 0.40  # centroid z < 0.40m → door
    WINDOW_SILL_MAX       = 2.50  # centroid z < 2.50m → window; else skylight
    LARGE_DOOR_AREA_M2    = 3.0   # area > 3m² → double door
    LARGE_WINDOW_AREA_M2  = 2.0   # area > 2m² → large window

    # Traversal limits
    MAX_RECURSION_DEPTH   = 50

    # Feature flags
    INCLUDE_EDGES              = false  # edges make JSON large
    INCLUDE_CONSTRUCTION_LINES = false

  end
end
```

---

## 5. UI: Export Dialog

```ruby
# bom_engine/ui_dialog.rb

module BOMEngine
  module UIDialog

    def self.show(&callback)
      dialog = UI::HtmlDialog.new(
        dialog_title:    "BOM Engine — Export Settings",
        scrollable:      false,
        resizable:       false,
        width:           480,
        height:          460,
        min_width:       400,
        min_height:      380,
        style:           UI::HtmlDialog::STYLE_DIALOG
      )

      html_path = File.join(BOMEngine::PLUGIN_PATH, "ui", "export_dialog.html")
      dialog.set_file(html_path)

      # Default output path
      model     = Sketchup.active_model
      default_path = model.path.empty? ?
        File.join(Dir.home, "bom_export.json") :
        model.path.gsub(".skp", "_bom.json")

      dialog.add_action_callback("onReady") do |_ctx|
        dialog.execute_script("setDefaultPath('#{default_path.gsub("\\", "\\\\")}')")
      end

      dialog.add_action_callback("browse") do |_ctx|
        chosen = UI.savepanel("Save BOM JSON", File.dirname(default_path), "*.json")
        dialog.execute_script("setPath('#{chosen.gsub("\\", "\\\\")}')") if chosen
      end

      dialog.add_action_callback("export") do |_ctx, settings_json|
        settings = JSON.parse(settings_json, symbolize_names: true) rescue {}
        dialog.close
        callback.call(settings) if callback
      end

      dialog.add_action_callback("cancel") { dialog.close }

      dialog.show
    end

  end
end
```

```html
<!-- ui/export_dialog.html -->
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 13px;
    background: #1e2229;
    color: #e0e4ea;
    padding: 20px;
  }
  h2 { font-size: 16px; font-weight: 600; color: #4fffb0; margin-bottom: 18px; }
  .field { margin-bottom: 14px; }
  label { display: block; font-size: 11px; color: #8899aa; margin-bottom: 5px;
          letter-spacing: 0.05em; text-transform: uppercase; }
  input[type=text] {
    width: 100%; padding: 8px 10px;
    background: #141720; border: 1px solid #2e3340; border-radius: 5px;
    color: #e0e4ea; font-size: 13px;
  }
  .path-row { display: flex; gap: 8px; }
  .path-row input { flex: 1; }
  .btn {
    padding: 8px 14px; border-radius: 5px; border: none;
    cursor: pointer; font-size: 12px; font-weight: 600;
  }
  .btn-browse { background: #2e3340; color: #aab; }
  .btn-browse:hover { background: #3a4050; }
  .checkbox-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .checkbox-row input { width: 15px; height: 15px; cursor: pointer; accent-color: #4fffb0; }
  .section { background: #151a22; border-radius: 8px; padding: 14px; margin-bottom: 14px; }
  .section h3 { font-size: 11px; text-transform: uppercase;
                color: #4fffb0; margin-bottom: 10px; letter-spacing: 0.1em; }
  .actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px; }
  .btn-cancel { background: #2e3340; color: #778899; padding: 10px 22px; border-radius: 6px; }
  .btn-export { background: #4fffb0; color: #111; padding: 10px 24px;
                border-radius: 6px; font-size: 13px; }
  .btn-export:hover { background: #3de89d; }
  .info { font-size: 11px; color: #556677; margin-top: 5px; }
</style>
</head>
<body>
  <h2>⬡ BOM Engine Export</h2>

  <div class="field">
    <label>Output JSON Path</label>
    <div class="path-row">
      <input type="text" id="outputPath" placeholder="/path/to/output.json">
      <button class="btn btn-browse" onclick="sketchup.browse()">Browse</button>
    </div>
  </div>

  <div class="section">
    <h3>Export Options</h3>
    <div class="checkbox-row">
      <input type="checkbox" id="exportTextures" checked>
      <label for="exportTextures" style="text-transform:none; font-size:13px; color:#c0ccd8;">
        Export textures to /textures subfolder
      </label>
    </div>
    <div class="checkbox-row">
      <input type="checkbox" id="includeEdges">
      <label for="includeEdges" style="text-transform:none; font-size:13px; color:#c0ccd8;">
        Include edge entities (increases file size)
      </label>
    </div>
    <div class="checkbox-row">
      <input type="checkbox" id="includeMaterials" checked>
      <label for="includeMaterials" style="text-transform:none; font-size:13px; color:#c0ccd8;">
        Include full material library
      </label>
    </div>
    <div class="checkbox-row">
      <input type="checkbox" id="prettyPrint" checked>
      <label for="prettyPrint" style="text-transform:none; font-size:13px; color:#c0ccd8;">
        Pretty-print JSON (human-readable)
      </label>
    </div>
  </div>

  <div class="section">
    <h3>Coordinate System</h3>
    <div class="checkbox-row">
      <input type="checkbox" id="useWorldSpace" checked disabled>
      <label for="useWorldSpace" style="text-transform:none; font-size:13px; color:#c0ccd8;">
        All coordinates in world space (absolute, meters)
      </label>
    </div>
    <p class="info">All vertices are exported in world-space coordinates (meters, SI). SketchUp Y-axis → JSON Y-axis.</p>
  </div>

  <div class="actions">
    <button class="btn btn-cancel" onclick="sketchup.cancel()">Cancel</button>
    <button class="btn btn-export" onclick="doExport()">Export JSON</button>
  </div>

<script>
  function setDefaultPath(path) {
    document.getElementById('outputPath').value = path;
  }
  function setPath(path) {
    document.getElementById('outputPath').value = path;
  }
  function doExport() {
    var settings = {
      output_path:       document.getElementById('outputPath').value,
      export_textures:   document.getElementById('exportTextures').checked,
      include_edges:     document.getElementById('includeEdges').checked,
      include_materials: document.getElementById('includeMaterials').checked,
      pretty_print:      document.getElementById('prettyPrint').checked
    };
    if (!settings.output_path) { alert('Please set an output path.'); return; }
    sketchup.export(JSON.stringify(settings));
  }
  window.onload = function() { sketchup.onReady(); };
</script>
</body>
</html>
```

---

## 6. Observer System (Real-Time Mode)

```ruby
# bom_engine/observer.rb

module BOMEngine

  # Fires a re-export to a temp JSON file whenever the model changes.
  # Used for real-time BOM preview in the web frontend.
  class BOMObserver < Sketchup::ModelObserver

    DEBOUNCE_DELAY = 1.5  # seconds — wait for user to stop editing before re-export

    def initialize
      @timer     = nil
      @temp_path = File.join(Dir.tmpdir, "bom_engine_live.json")
      Logger.info("BOM Observer initialized. Live output: #{@temp_path}")
    end

    def onTransactionCommit(model)
      debounced_export(model)
    end

    def onTransactionAbort(model)
      # no-op
    end

    private

    def debounced_export(model)
      # Cancel pending export if user is still editing
      UI.stop_timer(@timer) if @timer
      @timer = UI.start_timer(DEBOUNCE_DELAY, false) do
        begin
          Core.run_export({
            output_path:    @temp_path,
            export_textures: false,
            include_edges:  false,
            pretty_print:   false
          })
          Logger.info("Live export updated: #{@temp_path}")
        rescue => e
          Logger.error("Live export failed: #{e.message}")
        end
        @timer = nil
      end
    end

  end
end
```

---

## 7. Error Handling & Logging

```ruby
# bom_engine/logger.rb

module BOMEngine
  module Logger

    LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }.freeze
    CURRENT_LEVEL = :info

    def self.debug(msg) log(:debug, msg) end
    def self.info(msg)  log(:info,  msg) end
    def self.warn(msg)  log(:warn,  msg) end
    def self.error(msg) log(:error, msg) end

    private

    def self.log(level, msg)
      return if LEVELS[level] < LEVELS[CURRENT_LEVEL]
      prefix = {
        debug: "🔍 [BOM-DEBUG]",
        info:  "✅ [BOM-INFO]",
        warn:  "⚠️  [BOM-WARN]",
        error: "❌ [BOM-ERROR]"
      }[level]
      # Outputs to SketchUp Ruby Console
      puts "#{prefix} #{Time.now.strftime('%H:%M:%S')} — #{msg}"
    end

  end
end
```

---

## 8. JSON Schema Reference

```jsonc
// house_model.json — Complete schema v2.0
{
  "schema_version": "2.0",
  "exported_at": "2026-04-27T10:00:00Z",
  "software": "SketchUp 2024",
  "plugin_version": "2.0.0",

  "metadata": {
    "name": "Rumah Type 45",
    "description": "...",
    "filepath": "/path/to/model.skp",
    "guid": "abc123-...",
    "attribute_dictionaries": {}      // custom attributes from SketchUp
  },

  "units": {
    "length_unit_name": "Millimeters", // source unit
    "output_unit": "meters"           // always meters in output
  },

  "tags": [
    { "name": "Layer0", "visible": true, "color": { "r": 0, "g": 0, "b": 0 } }
  ],

  "materials": [
    {
      "id": "12345",
      "name": "Dinding_Putih",
      "color": { "r": 230, "g": 225, "b": 215, "hex": "#e6e1d7" },
      "alpha": 1.0,
      "material_type": 0,             // 0=flat, 1=texture, 2=colorized texture
      "texture": {                    // null if no texture
        "filename": "Dinding_Putih.png",
        "width_m": 0.5,
        "height_m": 0.5
      }
    }
  ],

  "spatial_analysis": {
    "building_dimensions": { "width_m": 9.0, "depth_m": 5.0, "height_m": 3.5 },
    "surface_summary": {
      "total_floor_area_m2": 45.0,
      "net_wall_area_m2": 88.5,
      "total_opening_area_m2": 10.0,
      "window_to_wall_ratio": 0.113,
      "wall_to_floor_ratio": 2.19
    },
    "openings": [
      {
        "id": "1234_hole_0",
        "opening_type": "window",     // door, window, large_window, skylight
        "surface_type": "wall_y_pos",
        "normal": { "x": 0.0, "y": 1.0, "z": 0.0 },
        "centroid": { "x": 2.5, "y": 5.0, "z": 1.2 },
        "estimated_area_m2": 1.44,
        "height_estimate_m": 1.2,
        "width_estimate_m":  1.2,
        "facade_orientation": "north"
      }
    ],
    "facade_orientations": {
      "area_m2": { "north": 21.0, "south": 21.0, "east": 14.0, "west": 14.0 }
    }
  },

  "entities": [
    {
      "type": "Face",
      "id": "1001",
      "layer": "Dinding",
      "surface_type": "wall_y_pos",
      "vertices": [
        { "position": { "x": 0.0, "y": 5.0, "z": 0.0 }, "uv": { "u": 0.0, "v": 0.0 } }
      ],
      "holes": [],
      "has_holes": false,
      "normal": { "x": 0.0, "y": 1.0, "z": 0.0 },
      "area_m2": 10.5,
      "material_front": {
        "name": "Dinding_Putih",
        "reflectance": 0.87,
        "acoustic_absorption": 0.04
      }
    },
    {
      "type": "Group",
      "id": "2001",
      "name": "Ruang Tamu",
      "children": [ /* nested entities */ ]
    }
  ]
}
```

---

## 9. Testing & Validation

### 9.1 Unit Tests

```ruby
# tests/test_classifier.rb
# Run in SketchUp Ruby Console: load 'path/to/test_classifier.rb'

require_relative '../bom_engine/constants'
require_relative '../bom_engine/classifier'

module BOMEngine
  module Tests

    def self.run_classifier
      pass = 0; fail_count = 0

      tests = [
        # [normal_x, normal_y, normal_z, expected_type]
        [0.0,  0.0,  1.0,  "floor"],
        [0.0,  0.0, -1.0,  "ceiling"],
        [1.0,  0.0,  0.0,  "wall_x_pos"],
        [-1.0, 0.0,  0.0,  "wall_x_neg"],
        [0.0,  1.0,  0.0,  "wall_y_pos"],
        [0.0, -1.0,  0.0,  "wall_y_neg"],
        [0.0,  0.0,  0.95, "floor"],         # near-flat floor
        [0.0,  0.0, -0.95, "ceiling"],       # near-flat ceiling
        [0.0,  0.707, 0.707, "roof_slope"],  # 45-degree slope
      ]

      tests.each do |nx, ny, nz, expected|
        v      = Geom::Vector3d.new(nx, ny, nz).normalize
        result = Classifier.classify(v)
        if result == expected
          pass += 1
          puts "  ✅ [#{nx}, #{ny}, #{nz}] → #{result}"
        else
          fail_count += 1
          puts "  ❌ [#{nx}, #{ny}, #{nz}] → #{result} (expected #{expected})"
        end
      end

      puts "\nClassifier Tests: #{pass}/#{pass + fail_count} passed"
    end

  end
end

BOMEngine::Tests.run_classifier
```

### 9.2 Integration Test

```ruby
# tests/test_integration.rb

module BOMEngine
  module Tests

    def self.run_full_export_test
      model = Sketchup.active_model
      if model.nil?
        puts "❌ No active model"
        return
      end

      # Use temp file
      out_path = File.join(Dir.tmpdir, "bom_test_#{Time.now.to_i}.json")

      Core.run_export({
        output_path:      out_path,
        export_textures:  false,
        include_edges:    false,
        pretty_print:     true
      })

      # Validate output
      data = JSON.parse(File.read(out_path))

      checks = {
        "schema_version present"     => !data["schema_version"].nil?,
        "entities array present"     => data["entities"].is_a?(Array),
        "spatial_analysis present"   => !data["spatial_analysis"].nil?,
        "floor_area > 0"             => (data.dig("spatial_analysis", "surface_summary", "total_floor_area_m2") || 0) > 0,
        "materials present"          => data["materials"].is_a?(Array),
        "all entities have type"     => data["entities"].all? { |e| e["type"] },
      }

      pass = checks.count { |_, v| v }
      checks.each { |name, ok| puts "  #{ok ? '✅' : '❌'} #{name}" }
      puts "\nIntegration Test: #{pass}/#{checks.length} passed"
      puts "Output: #{out_path}"
    end

  end
end

BOMEngine::Tests.run_full_export_test
```

---

## 10. Packaging as `.rbz`

```bash
# From project root directory

# 1. Ensure all files are in place
ls bom_engine_plugin/

# 2. Create ZIP (cross-platform)
# macOS/Linux:
zip -r bom_engine_plugin_v2.zip bom_engine_plugin/

# Windows PowerShell:
Compress-Archive -Path bom_engine_plugin\ -DestinationPath bom_engine_plugin_v2.zip

# 3. Rename to .rbz
mv bom_engine_plugin_v2.zip bom_engine_plugin_v2.rbz

# 4. Install in SketchUp
# Window → Extension Manager → Install Extension → select .rbz
```

---

## 11. Known Limitations & Workarounds

| Issue | Impact | Workaround |
|-------|--------|------------|
| `face.area` counts both sides | Double-counts wall area | Divide by 2 when classifying both sides, or use one-sided count from normal direction |
| Compound elements (wall intersects column) | Over-counts material at intersection | Post-process: detect overlapping bounding boxes and subtract intersection volume |
| Unnamed layers | Surface type defaults to "Layer0" | Convention: ask designers to use standard layer names; document naming guide |
| Very large models (>50k faces) | Export takes >30s | Add progress bar + background thread using `Sketchup::BackgroundThread` |
| ComponentInstance deep nesting | Geometry duplicated if same definition instanced many times | De-duplicate: collect definitions once, instance points to definition ID |
| Curved surfaces (arcs, circles) | Approximated as flat polygons | Accept as-is; document that curved geometry accuracy depends on polygon count in SketchUp |
| Texture not found | `tw.write` fails silently | Check `mat.texture.filename` exists before loading; log warning and skip |
| SketchUp free web version | Ruby API not available | Plugin requires SketchUp Pro/Studio |

---

## 12. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 2.0.0 | 2026-04 | World-space transforms, roof slope classification, room detection stub, observer debounce, full test suite |
| 1.5.0 | 2026-02 | Texture export, export dialog HTML, opening dimension estimates |
| 1.0.0 | 2025-12 | Initial release: basic face/group/component traversal, SNI absorption coefficients |

---

*Documentation maintained by [Research Team], [Institution Name], 2026.*
