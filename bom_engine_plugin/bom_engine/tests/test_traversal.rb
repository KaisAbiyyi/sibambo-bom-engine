# tests/test_traversal.rb
# Unit tests for BOMEngine::Traversal helper methods.
# Run in SketchUp Ruby Console:
#   load 'full/path/to/bom_engine_plugin/tests/test_traversal.rb'

require_relative '../constants'
require_relative '../traversal'

module BOMEngine
  module Tests

    def self.run_traversal
      puts "\n=== BOM Engine: Traversal Tests ==="
      pass = 0; fail_count = 0

      # --- pt_to_m: 1 inch = 0.0254 m ---
      pt = Geom::Point3d.new(1.0, 2.0, 3.0)  # in inches
      result = Traversal.pt_to_m(pt)
      expected = { x: 0.0254, y: 0.0508, z: 0.0762 }
      if result[:x].round(6) == expected[:x] && result[:y].round(6) == expected[:y]
        pass += 1
        puts "  PASS pt_to_m: 1in,2in,3in -> #{result.inspect}"
      else
        fail_count += 1
        puts "  FAIL pt_to_m: expected #{expected.inspect}, got #{result.inspect}"
      end

      # --- vec_hash ---
      v = Geom::Vector3d.new(1.0, 0.0, 0.0)
      h = Traversal.vec_hash(v)
      if h[:x] == 1.0 && h[:y] == 0.0 && h[:z] == 0.0
        pass += 1
        puts "  PASS vec_hash: #{h.inspect}"
      else
        fail_count += 1
        puts "  FAIL vec_hash: #{h.inspect}"
      end

      # --- estimate_reflectance ---
      white = Sketchup::Color.new(255, 255, 255)
      black = Sketchup::Color.new(0, 0, 0)
      ref_white = Traversal.estimate_reflectance(white)
      ref_black = Traversal.estimate_reflectance(black)
      if ref_white == 1.0 && ref_black == 0.0
        pass += 1
        puts "  PASS estimate_reflectance: white=#{ref_white}, black=#{ref_black}"
      else
        fail_count += 1
        puts "  FAIL estimate_reflectance: white=#{ref_white}, black=#{ref_black}"
      end

      # --- estimate_absorption ---
      carpet_val  = Traversal.estimate_absorption("karpet_ruang_tamu")
      default_val = Traversal.estimate_absorption("material_tidak_dikenal")
      if carpet_val == 0.35 && default_val == 0.05
        pass += 1
        puts "  PASS estimate_absorption: karpet=#{carpet_val}, unknown=#{default_val}"
      else
        fail_count += 1
        puts "  FAIL estimate_absorption: karpet=#{carpet_val} (exp 0.35), unknown=#{default_val} (exp 0.05)"
      end

      # --- extract_uv with nil helper ---
      uv = Traversal.extract_uv(nil, Geom::Point3d.new(0, 0, 0))
      if uv == { u: 0.0, v: 0.0 }
        pass += 1
        puts "  PASS extract_uv with nil helper: #{uv.inspect}"
      else
        fail_count += 1
        puts "  FAIL extract_uv with nil helper: #{uv.inspect}"
      end

      # --- world_area_m2 honors scaled instances ---
      model = Sketchup.active_model
      group = model.entities.add_group
      scaled_face = group.entities.add_face(
        [0, 0, 0],
        [10, 0, 0],
        [10, 10, 0],
        [0, 10, 0]
      )
      scale = Geom::Transformation.scaling(2.0, 3.0, 1.0)
      expected_area = 600.0 * Constants::IN2_TO_M2
      measured_area = Traversal.world_area_m2(scaled_face, scale)
      if (measured_area - expected_area).abs < 0.0001
        pass += 1
        puts "  PASS world_area_m2 with non-uniform scale: #{measured_area}"
      else
        fail_count += 1
        puts "  FAIL world_area_m2: expected #{expected_area}, got #{measured_area}"
      end
      group.erase!

      # --- build_face uses SketchUp mesh polygons with preserved total area ---
      mesh_group = model.entities.add_group
      begin
        mesh_face = mesh_group.entities.add_face(
          [0, 20, 0],
          [10, 20, 0],
          [10, 30, 0],
          [0, 30, 0]
        )
        exported_faces = Traversal.build_face(mesh_face, nil, Geom::Transformation.new, "visual")
        exported_area = exported_faces.sum { |item| item[:area_m2].to_f }
        expected_mesh_area = Traversal.world_area_m2(mesh_face, Geom::Transformation.new)
        mesh_ready = exported_faces.any? &&
          exported_faces.all? { |item| item[:vertices].length >= 3 && item[:holes] == [] } &&
          (exported_area - expected_mesh_area).abs < 0.0001
        if mesh_ready
          pass += 1
          puts "  PASS build_face mesh export preserves total area"
        else
          fail_count += 1
          puts "  FAIL build_face mesh export: expected area #{expected_mesh_area}, got #{exported_area}"
        end
      ensure
        mesh_group.erase! if mesh_group && !mesh_group.deleted?
      end

      # --- hidden entities are skipped ---
      visible_group = model.entities.add_group
      hidden_group  = model.entities.add_group
      begin
        visible_group.name = "Visible Export Test"
        visible_group.entities.add_face(
          [0, 0, 0],
          [10, 0, 0],
          [10, 10, 0],
          [0, 10, 0]
        )
        hidden_group.name = "Hidden Export Test"
        hidden_group.entities.add_face(
          [20, 0, 0],
          [30, 0, 0],
          [30, 10, 0],
          [20, 10, 0]
        )
        hidden_group.hidden = true

        walked = Traversal.walk(
          [visible_group, hidden_group],
          nil,
          Geom::Transformation.new,
          0,
          export_level: "visual",
          include_edges: false
        )
        if walked.length == 1 && walked[0][:name] == "Visible Export Test"
          pass += 1
          puts "  PASS hidden entity skipped during traversal"
        else
          fail_count += 1
          puts "  FAIL hidden entity skip: expected only visible group, got #{walked.map { |e| e[:name] }.inspect}"
        end
      ensure
        visible_group.erase! if visible_group && !visible_group.deleted?
        hidden_group.erase! if hidden_group && !hidden_group.deleted?
      end

      # --- parent group material is inherited by child faces ---
      material_group = model.entities.add_group
      mat = nil
      begin
        mat = model.materials.add("BOM Engine Test Parent Material #{Time.now.to_f}")
        mat.color = Sketchup::Color.new(200, 80, 40)
        material_group.name = "Material Inheritance Test"
        material_group.material = mat
        material_group.entities.add_face(
          [40, 0, 0],
          [50, 0, 0],
          [50, 10, 0],
          [40, 10, 0]
        )

        walked = Traversal.walk(
          [material_group],
          nil,
          Geom::Transformation.new,
          0,
          export_level: "visual",
          include_edges: false
        )
        child_face = walked[0] && walked[0][:children] && walked[0][:children][0]
        if child_face && child_face[:mat_color] == "#c85028"
          pass += 1
          puts "  PASS parent material inherited by child face"
        else
          fail_count += 1
          puts "  FAIL material inheritance: expected #c85028, got #{child_face && child_face[:mat_color]}"
        end
      ensure
        material_group.erase! if material_group && !material_group.deleted?
        begin
          model.materials.remove(mat) if mat && model.materials.respond_to?(:remove)
        rescue
        end
      end

      total = pass + fail_count
      puts "\nTraversal Tests: #{pass}/#{total} passed"
      puts fail_count > 0 ? "SOME TESTS FAILED" : "ALL TESTS PASSED"
    end

  end
end

BOMEngine::Tests.run_traversal
