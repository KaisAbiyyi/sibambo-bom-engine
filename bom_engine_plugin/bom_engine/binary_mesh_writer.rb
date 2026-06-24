# bom_engine/binary_mesh_writer.rb
# Packs compact mesh payload into a binary container:
#   magic "BOME1\n"
#   uint32 little-endian header byte length
#   uint32 little-endian position int count
#   uint32 little-endian face int count
#   uint32 little-endian position byte length
#   uint32 little-endian face byte length
#   UTF-8 JSON header, padded with spaces to 4-byte alignment
#   int32 little-endian positions
#   int32 little-endian faces

require 'json'
require 'zlib'

module BOMEngine
  module BinaryMeshWriter
    MAGIC = "BOME1\n".b
    CHUNK_INTS = 16_384
    LAYOUT = "positions_then_faces_v2_int_counts"

    def self.pack(payload)
      buffer = +"".b
      write_to(buffer, payload)
      buffer
    end

    def self.write(path, payload, compress:)
      if compress
        Zlib::GzipWriter.open(path) { |gzip| write_to(gzip, payload) }
      else
        File.open(path, "wb") { |file| write_to(file, payload) }
      end
    end

    def self.write_to(io, payload)
      mesh = payload[:mesh]
      raise "Binary mesh export requires compact mesh payload." unless mesh

      positions = mesh[:positions] || []
      faces = mesh[:faces] || []
      write_header(io, payload, position_count: positions.length, face_int_count: faces.length)
      write_ints(io, positions)
      write_ints(io, faces)
    end

    def self.write_header(io, payload, position_count:, face_int_count:)
      mesh = payload[:mesh]
      raise "Binary mesh export requires compact mesh payload." unless mesh

      position_byte_count = position_count * 4
      face_byte_count = face_int_count * 4
      header = payload.reject { |key, _| key == :mesh }
      header[:geometry_format] = "binary_mesh_v1"
      header[:mesh] = mesh.reject { |key, _| key == :positions || key == :faces }
      header[:mesh][:binary_layout] = LAYOUT
      header[:mesh][:position_count] = position_count
      header[:mesh][:face_int_count] = face_int_count
      header_json = JSON.generate(header)
      padding = (4 - ((MAGIC.bytesize + 20 + header_json.bytesize) % 4)) % 4
      header_bytes = header_json + (" " * padding)

      output = MAGIC.dup
      output << [
        header_bytes.bytesize,
        position_count,
        face_int_count,
        position_byte_count,
        face_byte_count
      ].pack("V5")
      io.write(output)
      io.write(header_bytes.b)
    end

    def self.write_ints(io, values)
      index = 0
      while index < values.length
        io.write(values[index, CHUNK_INTS].pack("l<*"))
        index += CHUNK_INTS
      end
    end
  end
end
