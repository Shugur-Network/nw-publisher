/**
 * Logger Utility
 *
 * Centralized logging with different log levels and formatting.
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  SILENT: 4,
};

class Logger {
  constructor(level = "INFO") {
    this.level = LOG_LEVELS[level] || LOG_LEVELS.INFO;
  }

  /**
   * Set log level
   * @param {string} level - Log level (DEBUG, INFO, WARN, ERROR, SILENT)
   */
  setLevel(level) {
    this.level = LOG_LEVELS[level] || LOG_LEVELS.INFO;
  }

  /**
   * Debug level logging
   * @param {string} message - Message to log
   * @param {...any} args - Additional arguments
   */
  debug(message, ...args) {
    if (this.level <= LOG_LEVELS.DEBUG) {
      console.log(`🔍 ${message}`, ...args);
    }
  }

  /**
   * Info level logging
   * @param {string} message - Message to log
   * @param {...any} args - Additional arguments
   */
  info(message, ...args) {
    if (this.level <= LOG_LEVELS.INFO) {
      console.log(`ℹ️  ${message}`, ...args);
    }
  }

  /**
   * Success logging (special info)
   * @param {string} message - Message to log
   * @param {...any} args - Additional arguments
   */
  success(message, ...args) {
    if (this.level <= LOG_LEVELS.INFO) {
      console.log(`✅ ${message}`, ...args);
    }
  }

  /**
   * Warning level logging
   * @param {string} message - Message to log
   * @param {...any} args - Additional arguments
   */
  warn(message, ...args) {
    if (this.level <= LOG_LEVELS.WARN) {
      console.warn(`⚠️  ${message}`, ...args);
    }
  }

  /**
   * Error level logging
   * @param {string} message - Message to log
   * @param {...any} args - Additional arguments
   */
  error(message, ...args) {
    if (this.level <= LOG_LEVELS.ERROR) {
      console.error(`❌ ${message}`, ...args);
    }
  }

  /**
   * Log separator line
   */
  separator() {
    if (this.level <= LOG_LEVELS.INFO) {
      console.log(
        "======================================================================"
      );
    }
  }

  /**
   * Log header with separator
   * @param {string} title - Header title
   */
  header(title) {
    if (this.level <= LOG_LEVELS.INFO) {
      console.log("");
      this.separator();
      console.log(title);
      this.separator();
      console.log("");
    }
  }
}

// Export singleton instance
export const logger = new Logger(process.env.LOG_LEVEL || "INFO");

// Export LOG_LEVELS for external use
export { LOG_LEVELS };
