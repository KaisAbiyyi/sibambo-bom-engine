# bom_engine/material_extractor.rb
# Extracts all materials from the model, including texture metadata.
# Actual texture file writing is handled by TextureExporter.

module BOMEngine
  module MaterialExtractor

    # @param model       [Sketchup::Model]
    # @param tw          [Sketchup::TextureWriter]
    # @param texture_dir [String, nil] output directory; nil means skip texture export
    # @return            [Array<Hash>] material descriptors
    def self.extract(model, tw, texture_dir)
      Dir.mkdir(texture_dir) if texture_dir && !Dir.exist?(texture_dir)
      written = 0

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
          tex       = mat.texture
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

          # Register texture for writing — actual write happens in TextureExporter
          begin
            out_path = File.join(texture_dir, tex_filename)
            written += 1 if tex.write(out_path, true)
          rescue => e
            Logger.warn("Could not write texture for '#{mat.name}': #{e.message}")
          end
        end

        entry
      end.tap do
        Logger.info("Wrote #{written} texture(s) to #{texture_dir}") if texture_dir
      end
    end

  end
end
