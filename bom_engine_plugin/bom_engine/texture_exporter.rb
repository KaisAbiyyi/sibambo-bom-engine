# bom_engine/texture_exporter.rb
# Writes texture bitmaps registered in a TextureWriter to disk.

module BOMEngine
  module TextureExporter

    # Write all registered textures to texture_dir as PNG files.
    #
    # @param tw          [Sketchup::TextureWriter] populated by MaterialExtractor
    # @param texture_dir [String, nil]
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
          Logger.warn("Could not write texture '#{safe_name}': #{e.message}")
        end
      end

      Logger.info("Wrote #{written} texture(s) to #{texture_dir}")
    end

  end
end
