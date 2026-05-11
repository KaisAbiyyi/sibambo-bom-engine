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

      total = pass + fail_count
      puts "\nTraversal Tests: #{pass}/#{total} passed"
      puts fail_count > 0 ? "SOME TESTS FAILED" : "ALL TESTS PASSED"
    end

  end
end

BOMEngine::Tests.run_traversal
