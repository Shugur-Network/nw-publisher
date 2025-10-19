/**
 * Error Handling Utilities
 *
 * Custom error classes and error handling utilities.
 */

import { EXIT_CODES } from "../lib/constants.mjs";
import { logger } from "./logger.mjs";

/**
 * Base application error
 */
export class AppError extends Error {
  constructor(message, code = EXIT_CODES.ERROR, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Configuration error
 */
export class ConfigError extends AppError {
  constructor(message, details = {}) {
    super(message, EXIT_CODES.ERROR, details);
  }
}

/**
 * Validation error
 */
export class ValidationError extends AppError {
  constructor(message, details = {}) {
    super(message, EXIT_CODES.ERROR, details);
  }
}

/**
 * Network error
 */
export class NetworkError extends AppError {
  constructor(message, details = {}) {
    super(message, EXIT_CODES.ERROR, details);
  }
}

/**
 * File system error
 */
export class FileSystemError extends AppError {
  constructor(message, details = {}) {
    super(message, EXIT_CODES.ERROR, details);
  }
}

/**
 * Handle error and exit
 *
 * @param {Error} error - Error object
 * @param {boolean} exit - Whether to exit process
 */
export function handleError(error, exit = true) {
  if (error instanceof AppError) {
    logger.error(error.message);

    if (Object.keys(error.details).length > 0) {
      logger.debug("Error details:", error.details);
    }

    if (exit) {
      process.exit(error.code);
    }
  } else {
    logger.error(`Unexpected error: ${error.message}`);
    logger.debug(error.stack);

    if (exit) {
      process.exit(EXIT_CODES.ERROR);
    }
  }
}

/**
 * Wrap async function with error handler
 *
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Wrapped function
 */
export function withErrorHandler(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      handleError(error);
    }
  };
}

/**
 * Assert condition or throw error
 *
 * @param {boolean} condition - Condition to check
 * @param {string} message - Error message if condition is false
 * @param {typeof AppError} ErrorClass - Error class to throw
 */
export function assert(condition, message, ErrorClass = AppError) {
  if (!condition) {
    throw new ErrorClass(message);
  }
}

/**
 * Retry function with exponential backoff
 *
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in ms
 * @param {number} multiplier - Backoff multiplier
 * @returns {Promise<any>} Function result
 */
export async function retry(
  fn,
  maxRetries = 3,
  baseDelay = 1000,
  multiplier = 2
) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(multiplier, attempt);
        logger.debug(
          `Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`
        );
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * Sleep utility
 *
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Safely execute function and catch errors
 *
 * @param {Function} fn - Function to execute
 * @param {any} defaultValue - Default value if error occurs
 * @returns {any} Function result or default value
 */
export async function safely(fn, defaultValue = null) {
  try {
    return await fn();
  } catch (error) {
    logger.debug(`Safely caught error: ${error.message}`);
    return defaultValue;
  }
}

/**
 * Create error handler middleware
 *
 * @param {Function} handler - Custom error handler
 * @returns {Function} Error handler function
 */
export function createErrorHandler(handler) {
  return (error) => {
    if (typeof handler === "function") {
      handler(error);
    }
    handleError(error);
  };
}
