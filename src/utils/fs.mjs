/**
 * File System Utilities
 *
 * Safe file system operations with error handling.
 */

import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger.mjs";

/**
 * Safely read JSON file
 *
 * @param {string} filePath - Path to JSON file
 * @param {Object} defaultValue - Default value if file doesn't exist or is invalid
 * @returns {Object} Parsed JSON or default value
 */
export function readJSONFile(filePath, defaultValue = {}) {
  try {
    if (!fs.existsSync(filePath)) {
      return defaultValue;
    }

    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    logger.warn(`Failed to read JSON file ${filePath}: ${error.message}`);
    return defaultValue;
  }
}

/**
 * Safely write JSON file
 *
 * @param {string} filePath - Path to JSON file
 * @param {Object} data - Data to write
 * @param {boolean} pretty - Pretty print JSON
 * @returns {boolean} True if successful
 */
export function writeJSONFile(filePath, data, pretty = true) {
  try {
    const content = pretty
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, content, "utf8");
    return true;
  } catch (error) {
    logger.error(`Failed to write JSON file ${filePath}: ${error.message}`);
    return false;
  }
}

/**
 * Safely read text file
 *
 * @param {string} filePath - Path to text file
 * @param {string} defaultValue - Default value if file doesn't exist
 * @returns {string} File content or default value
 */
export function readTextFile(filePath, defaultValue = "") {
  try {
    if (!fs.existsSync(filePath)) {
      return defaultValue;
    }

    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    logger.warn(`Failed to read text file ${filePath}: ${error.message}`);
    return defaultValue;
  }
}

/**
 * Safely write text file
 *
 * @param {string} filePath - Path to text file
 * @param {string} content - Content to write
 * @returns {boolean} True if successful
 */
export function writeTextFile(filePath, content) {
  try {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, content, "utf8");
    return true;
  } catch (error) {
    logger.error(`Failed to write text file ${filePath}: ${error.message}`);
    return false;
  }
}

/**
 * Safely delete file
 *
 * @param {string} filePath - Path to file
 * @returns {boolean} True if successful
 */
export function deleteFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return true;
  } catch (error) {
    logger.warn(`Failed to delete file ${filePath}: ${error.message}`);
    return false;
  }
}

/**
 * Get all files in directory recursively
 *
 * @param {string} dir - Directory path
 * @param {Array<string>} extensions - File extensions to include (e.g., ['.html', '.css'])
 * @returns {Array<string>} Array of file paths
 */
export function getFilesRecursive(dir, extensions = []) {
  const files = [];

  function traverse(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden directories and common exclusions
        if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
          traverse(fullPath);
        }
      } else if (entry.isFile()) {
        // Include file if no extensions specified or extension matches
        if (
          extensions.length === 0 ||
          extensions.some((ext) => entry.name.endsWith(ext))
        ) {
          files.push(fullPath);
        }
      }
    }
  }

  traverse(dir);
  return files;
}

/**
 * Ensure directory exists
 *
 * @param {string} dirPath - Directory path
 * @returns {boolean} True if successful
 */
export function ensureDirectory(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    return true;
  } catch (error) {
    logger.error(`Failed to create directory ${dirPath}: ${error.message}`);
    return false;
  }
}

/**
 * Get file extension
 *
 * @param {string} filePath - File path
 * @returns {string} Extension (e.g., '.html')
 */
export function getExtension(filePath) {
  return path.extname(filePath).toLowerCase();
}

/**
 * Get filename without extension
 *
 * @param {string} filePath - File path
 * @returns {string} Filename without extension
 */
export function getBasename(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

/**
 * Check if file exists
 *
 * @param {string} filePath - File path
 * @returns {boolean} True if exists
 */
export function fileExists(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Check if directory exists
 *
 * @param {string} dirPath - Directory path
 * @returns {boolean} True if exists
 */
export function directoryExists(dirPath) {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Get file size in bytes
 *
 * @param {string} filePath - File path
 * @returns {number} File size in bytes
 */
export function getFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

/**
 * Copy file
 *
 * @param {string} source - Source file path
 * @param {string} destination - Destination file path
 * @returns {boolean} True if successful
 */
export function copyFile(source, destination) {
  try {
    const dir = path.dirname(destination);
    ensureDirectory(dir);
    fs.copyFileSync(source, destination);
    return true;
  } catch (error) {
    logger.error(
      `Failed to copy file ${source} to ${destination}: ${error.message}`
    );
    return false;
  }
}
