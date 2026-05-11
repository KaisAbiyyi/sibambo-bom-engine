# tests/test_classifier.rb
# Unit tests for BOMEngine::Classifier
# Run in SketchUp Ruby Console:
#   load 'full/path/to/bom_engine_plugin/tests/test_classifier.rb'

require_relative '../constants'
require_relative '../classifier'

module BOMEngine
  module Tests

    def self.run_classifier
      puts "\n=== BOM Engine: Classifier Tests ==="
      pass = 0; fail_count = 0

      tests = [
        # [nx, ny, nz, expected_full_type]
        [ 0.0,  0.0,  1.0,  "floor"],
        [ 0.0,  0.0, -1.0,  "ceiling"],
        [ 1.0,  0.0,  0.0,  "wall_x_pos"],
        [-1.0,  0.0,  0.0,  "wall_x_neg"],
        [ 0.0,  1.0,  0.0,  "wall_y_pos"],
        [ 0.0, -1.0,  0.0,  "wall_y_neg"],
        [ 0.0,  0.0,  0.95, "floor"],          # near-flat floor
        [ 0.0,  0.0, -0.95, "ceiling"],        # near-flat ceiling
        [ 0.0,  0.707,  0.707, "roof_slope"],  # 45-degree slope
        [ 0.0, -0.707,  0.707, "roof_slope"],  # 45-degree slope (south)
      ]

      tests.each do |nx, ny, nz, expected|
        v      = Geom::Vector3d.new(nx, ny, nz).normalize
        result = Classifier.classify(v)
        if result == expected
          pass += 1
          puts "  PASS [#{nx}, #{ny}, #{nz}] -> #{result}"
        else
          fail_count += 1
          puts "  FAIL [#{nx}, #{ny}, #{nz}] -> #{result} (expected: #{expected})"
        end
      end

      # Simplified classification tests
      puts "\n--- Simplified classification ---"
      simplified_tests = [
        [ 0.0,  0.0,  1.0,  "floor"],
        [ 0.0,  0.0, -1.0,  "ceiling"],
        [ 1.0,  0.0,  0.0,  "wall"],
        [ 0.0,  0.707, 0.707, "ceiling"],  # roof_slope maps to ceiling
      ]
      simplified_tests.each do |nx, ny, nz, expected|
        v      = Geom::Vector3d.new(nx, ny, nz).normalize
        result = Classifier.simplified(v)
        if result == expected
          pass += 1
          puts "  PASS simplified [#{nx}, #{ny}, #{nz}] -> #{result}"
        else
          fail_count += 1
          puts "  FAIL simplified [#{nx}, #{ny}, #{nz}] -> #{result} (expected: #{expected})"
        end
      end

      # Facade orientation tests
      puts "\n--- Facade orientation ---"
      orientation_tests = [
        [ 0.0,  1.0,  0.0, 0.0, "north"],
        [ 0.0, -1.0,  0.0, 0.0, "south"],
        [ 1.0,  0.0,  0.0, 0.0, "east"],
        [-1.0,  0.0,  0.0, 0.0, "west"],
      ]
      orientation_tests.each do |nx, ny, nz, north_angle, expected|
        v      = Geom::Vector3d.new(nx, ny, nz).normalize
        result = Classifier.facade_orientation(v, north_angle)
        if result == expected
          pass += 1
          puts "  PASS orientation [#{nx}, #{ny}, #{nz}] -> #{result}"
        else
          fail_count += 1
          puts "  FAIL orientation [#{nx}, #{ny}, #{nz}] -> #{result} (expected: #{expected})"
        end
      end

      total = pass + fail_count
      puts "\nClassifier Tests: #{pass}/#{total} passed"
      puts fail_count > 0 ? "SOME TESTS FAILED" : "ALL TESTS PASSED"
    end

  end
end

BOMEngine::Tests.run_classifier
