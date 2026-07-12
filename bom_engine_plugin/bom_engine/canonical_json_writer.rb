# bom_engine/canonical_json_writer.rb
# Serializes canonical JSON v3 as readable/minified JSON with optional gzip.

require 'digest'
require 'json'
require 'zlib'

module BOMEngine
  module CanonicalJSONWriter
    class << self
      attr_reader :last_result
    end

    def self.write(path, graph, pretty:, compress:)
      content = pretty ? JSON.pretty_generate(graph) : JSON.generate(graph)
      content << "\n" if pretty

      if compress
        Zlib::GzipWriter.open(path) do |gzip|
          gzip.mtime = 0
          gzip.write(content)
        end
      else
        File.open(path, 'w:UTF-8') { |file| file.write(content) }
      end

      @last_result = {
        path: path,
        compressed: compress,
        pretty: pretty,
        bytes: File.size(path),
        uncompressed_bytes: content.bytesize,
        sha256: Digest::SHA256.file(path).hexdigest
      }
    end
  end
end
