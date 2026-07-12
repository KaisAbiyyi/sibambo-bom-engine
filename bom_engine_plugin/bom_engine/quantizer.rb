# Adaptive per-mesh position quantization with a measured error budget.

module BOMEngine
  module Quantizer
    MAX_ERROR_M = 0.001
    UINT16_MAX = 65_535
    UINT32_MAX = 4_294_967_295

    def self.quantize_positions(positions, max_error_m: MAX_ERROR_M)
      raise 'Position buffer must contain XYZ triples.' unless (positions.length % 3).zero?

      points = positions.each_slice(3).to_a
      minimum = 3.times.map { |axis| points.empty? ? 0.0 : points.map { |point| point[axis].to_f }.min }
      maximum = 3.times.map { |axis| points.empty? ? 0.0 : points.map { |point| point[axis].to_f }.max }
      spans = 3.times.map { |axis| maximum[axis] - minimum[axis] }
      uint16_scale = spans.map { |span| span.zero? ? 0.0 : span / UINT16_MAX }
      uint16_bound = Math.sqrt(uint16_scale.sum { |scale| (scale * 0.5)**2 })
      component_type = uint16_bound <= max_error_m ? 'uint16' : 'uint32'
      maximum_integer = component_type == 'uint16' ? UINT16_MAX : UINT32_MAX
      scale = spans.map { |span| span.zero? ? 0.0 : span / maximum_integer }
      values = positions.each_slice(3).flat_map do |point|
        3.times.map do |axis|
          scale[axis].zero? ? 0 : ((point[axis].to_f - minimum[axis]) / scale[axis]).round
        end
      end

      result = {
        component_type: component_type,
        values: values,
        minimum_m: minimum.map { |value| value.round(12) },
        maximum_m: maximum.map { |value| value.round(12) },
        scale_m: scale.map { |value| value.round(15) },
        measured_max_error_m: 0.0,
        error_budget_m: max_error_m
      }
      decoded = dequantize_positions(result)
      measured = positions.each_slice(3).with_index.map do |point, point_index|
        offset = point_index * 3
        Math.sqrt(3.times.sum { |axis| (point[axis].to_f - decoded[offset + axis])**2 })
      end.max || 0.0
      result[:measured_max_error_m] = measured.round(12)
      raise "Quantization error #{measured}m exceeds #{max_error_m}m." if measured > max_error_m + 1.0e-12

      result
    end

    def self.dequantize_positions(quantized)
      minimum = quantized[:minimum_m]
      scale = quantized[:scale_m]
      quantized[:values].each_slice(3).flat_map do |point|
        3.times.map { |axis| minimum[axis].to_f + point[axis].to_f * scale[axis].to_f }
      end
    end

    def self.pack_values(quantized)
      quantized[:values].pack(quantized[:component_type] == 'uint16' ? 'S<*' : 'V*')
    end
  end
end
