# bom_engine/binary_mesh_validator.rb
# Streaming sanity checks for .bome/.bome.gz files after export.

require 'json'
require 'zlib'

module BOMEngine
  module BinaryMeshValidator
    MAGIC = BinaryMeshWriter::MAGIC
    FIXED_HEADER_BYTES = 20
    INT_BYTES = 4
    ROW_CHUNK = 16_384
    LAYOUT = BinaryMeshWriter::LAYOUT

    def self.validate(path)
      open_reader(path) { |io| validate_io(io, path) }
    end

    def self.open_reader(path)
      if path.to_s.downcase.end_with?(".gz")
        Zlib::GzipReader.open(path) { |gzip| yield gzip }
      else
        File.open(path, "rb") { |file| yield file }
      end
    end
    private_class_method :open_reader

    def self.validate_io(io, path)
      magic = read_exact(io, MAGIC.bytesize, "magic")
      raise "BOME invalid: magic mismatch." unless magic == MAGIC

      fixed = read_exact(io, FIXED_HEADER_BYTES, "fixed header").unpack("V5")
      header_bytes, position_count, face_int_count, position_byte_count, face_byte_count = fixed
      if position_byte_count != position_count * INT_BYTES || face_byte_count != face_int_count * INT_BYTES
        raise "BOME invalid: byte counts do not match int counts."
      end
      raise "BOME invalid: position count must be divisible by 3." unless (position_count % 3).zero?

      header = JSON.parse(read_exact(io, header_bytes, "json header"))
      mesh = header["mesh"] || {}
      raise "BOME invalid: missing mesh header." if mesh.empty?
      raise "BOME invalid: stale binary layout marker." unless mesh["binary_layout"] == LAYOUT

      stride = (mesh["face_stride"] || 0).to_i
      raise "BOME invalid: face_stride must be at least 9." if stride < 9
      raise "BOME invalid: face int count not divisible by stride." unless (face_int_count % stride).zero?

      skip_exact(io, position_byte_count, "positions")
      validate_faces(io, face_int_count, stride, position_count / 3, mesh)

      extra = io.read(1)
      raise "BOME invalid: trailing bytes after face table." unless extra.nil? || extra.empty?

      {
        path: path,
        format: header["geometry_format"],
        position_count: position_count,
        face_count: face_int_count / stride,
        layout: mesh["binary_layout"]
      }
    end
    private_class_method :validate_io

    def self.validate_faces(io, face_int_count, stride, vertex_count, mesh)
      row_count = face_int_count / stride
      row_size = stride * INT_BYTES
      surface_count = Array(mesh["surfaces"]).length
      material_count = Array(mesh["materials"]).length
      layer_count = Array(mesh["layers"]).length
      row_index = 0

      while row_index < row_count
        batch_rows = [ROW_CHUNK, row_count - row_index].min
        ints = read_exact(io, batch_rows * row_size, "faces").unpack("l<*")
        batch_rows.times do |local_row|
          base = local_row * stride
          start = ints[base]
          length = ints[base + 1]
          surface_idx = ints[base + 2]
          material_idx = ints[base + 3]
          layer_idx = ints[base + 4]
          face_no = row_index + local_row + 1

          raise "BOME invalid at face #{face_no}: vertex_count < 3." if length < 3
          if start < 0 || start + length > vertex_count
            raise "BOME invalid at face #{face_no}: vertex range outside position buffer."
          end
          if surface_idx < 0 || surface_idx >= surface_count
            raise "BOME invalid at face #{face_no}: surface index outside dictionary."
          end
          if material_idx < -1 || (material_idx >= 0 && material_idx >= material_count)
            raise "BOME invalid at face #{face_no}: material index outside dictionary."
          end
          if layer_idx < -1 || (layer_idx >= 0 && layer_idx >= layer_count)
            raise "BOME invalid at face #{face_no}: layer index outside dictionary."
          end
        end
        row_index += batch_rows
      end
    end
    private_class_method :validate_faces

    def self.read_exact(io, byte_count, label)
      data = io.read(byte_count)
      if data.nil? || data.bytesize != byte_count
        raise "BOME invalid: truncated #{label}."
      end
      data
    end
    private_class_method :read_exact

    def self.skip_exact(io, byte_count, label)
      remaining = byte_count
      while remaining > 0
        chunk = io.read([remaining, 1_048_576].min)
        if chunk.nil? || chunk.empty?
          raise "BOME invalid: truncated #{label}."
        end
        remaining -= chunk.bytesize
      end
    end
    private_class_method :skip_exact
  end
end
