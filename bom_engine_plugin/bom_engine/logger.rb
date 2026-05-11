# bom_engine/logger.rb
# Structured logging to SketchUp Ruby Console.

module BOMEngine
  module Logger

    LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }.freeze
    CURRENT_LEVEL = :info

    def self.debug(msg) log(:debug, msg) end
    def self.info(msg)  log(:info,  msg) end
    def self.warn(msg)  log(:warn,  msg) end
    def self.error(msg) log(:error, msg) end

    private

    def self.log(level, msg)
      return if LEVELS[level] < LEVELS[CURRENT_LEVEL]
      prefix = {
        debug: "[BOM-DEBUG]",
        info:  "[BOM-INFO] ",
        warn:  "[BOM-WARN] ",
        error: "[BOM-ERROR]"
      }[level]
      # Outputs to SketchUp Ruby Console
      puts "#{prefix} #{Time.now.strftime('%H:%M:%S')} — #{msg}"
    end

  end
end
