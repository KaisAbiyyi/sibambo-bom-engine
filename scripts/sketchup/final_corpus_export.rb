# frozen_string_literal: true

# Loaded from SketchUp Ruby Console after each corpus model is opened directly.
# Produces canonical v3 and BOME2 artifacts without saving or modifying the SKP.

require "digest"
require "fileutils"
require "json"
require "time"
require "zlib"

module BOMWorkflow
  module FinalCorpusExport
    ROOT = "D:/projects/sibambo-bom-engine" unless const_defined?(:ROOT, false)
    MODELS = {
      "house2" => "house2.skp",
      "presentation20" => "presentation20.skp",
      "project-sboost" => "PROJECT SBOOST !.skp",
      "project-sboost-2" => "PROJECT SBOOST 2.skp",
      "test" => "test.skp"
    }.freeze unless const_defined?(:MODELS, false)

    def self.export_current(slug)
      expected_name = MODELS.fetch(slug) { raise ArgumentError, "Unknown corpus slug: #{slug}" }
      model = Sketchup.active_model
      source_path = model.path.to_s
      raise "Active model has not been saved" if source_path.empty?
      unless File.basename(source_path).casecmp?(expected_name)
        raise "Active model mismatch: expected #{expected_name}, got #{File.basename(source_path)}"
      end
      raise "BOM Engine v3 is not loaded" unless defined?(BOMEngine::Core) && BOMEngine::PLUGIN_VERSION == "3.0.0"

      export_dir = File.join(ROOT, "artifacts", slug, "exported")
      metrics_dir = File.join(ROOT, "artifacts", slug, "metrics")
      log_dir = File.join(ROOT, "artifacts", slug, "logs")
      [export_dir, metrics_dir, log_dir].each { |path| FileUtils.mkdir_p(path) }

      modified_before = model.modified?
      rows = %w[canonical_v3 bome2].map do |format|
        export_format(model, slug, format, export_dir)
      rescue StandardError => error
        {
          format: format,
          status: "error",
          error: "#{error.class}: #{error.message}",
          backtrace: error.backtrace&.first(8)
        }
      end

      payload = {
        workflow_version: "1.0.0",
        measured_at: Time.now.utc.iso8601,
        status: rows.all? { |row| row[:status] == "ok" } ? "ok" : "error",
        plugin_version: BOMEngine::PLUGIN_VERSION,
        sketchup_version: Sketchup.version,
        source_skp: source_path,
        source_bytes: File.size(source_path),
        source_sha256: Digest::SHA256.file(source_path).hexdigest,
        source_modified_before: modified_before,
        source_modified_after: model.modified?,
        formats: rows
      }
      metrics_path = File.join(metrics_dir, "final-export.json")
      File.write(metrics_path, JSON.pretty_generate(payload), mode: "w:UTF-8")
      File.write(
        File.join(log_dir, "final-export.log"),
        "#{payload[:measured_at]} #{payload[:status]} #{source_path} #{rows.map { |row| "#{row[:format]}=#{row[:status]}" }.join(" ")}\n",
        mode: "a:UTF-8"
      )
      puts "BOM_WORKFLOW_FINAL_EXPORT_#{payload[:status].upcase} #{metrics_path}"
      payload
    end

    def self.export_format(model, slug, format, export_dir)
      GC.start
      gc_before = GC.stat
      started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      result = BOMEngine::Core.run_export(
        output_path: File.join(export_dir, "#{slug}.json"),
        output_format: format,
        compress_output: true,
        export_textures: false,
        include_edges: false,
        include_materials: true,
        pretty_print: false,
        selection_only: false,
        silent: true
      )
      raise "Exporter returned nil" unless result && File.file?(result[:path])

      validation = format == "bome2" ? validate_bome2(result[:path]) : validate_canonical(result[:path])
      elapsed_ms = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000.0).round(2)
      gc_after = GC.stat
      {
        format: format,
        status: "ok",
        output_path: result[:path],
        output_bytes: File.size(result[:path]),
        output_sha256: Digest::SHA256.file(result[:path]).hexdigest,
        wall_elapsed_ms: elapsed_ms,
        plugin_elapsed_ms: (result[:elapsed_seconds].to_f * 1000.0).round(2),
        heap_live_slots_delta: gc_after[:heap_live_slots] - gc_before[:heap_live_slots],
        result: result,
        validation: validation
      }
    end

    def self.validate_bome2(path)
      bytes = Zlib::GzipReader.open(path, &:read)
      BOMEngine::BOME2Writer.validate(bytes).merge(uncompressed_bytes: bytes.bytesize)
    end

    def self.validate_canonical(path)
      json = Zlib::GzipReader.open(path, &:read)
      graph = JSON.parse(json)
      raise "Canonical format name mismatch" unless graph.dig("format", "name") == "BOM Engine Canonical"
      raise "Canonical format version mismatch" unless graph.dig("format", "version") == "3.0.0"
      %w[meshes definitions nodes materials transforms].each do |field|
        raise "Canonical field #{field} missing" unless graph[field].is_a?(Array)
      end
      {
        format: graph.dig("format", "version"),
        uncompressed_bytes: json.bytesize,
        meshes: graph["meshes"].length,
        definitions: graph["definitions"].length,
        nodes: graph["nodes"].length,
        materials: graph["materials"].length,
        transforms: graph["transforms"].length
      }
    end
  end
end
