#!/usr/bin/env node
/**
 * Config Manager Command - Refactored Version
 *
 * Manages project configuration, environment variables, and settings.
 */

import path from "node:path";
import dotenv from "dotenv";
import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import { nip19 } from "nostr-tools";

// Import refactored utilities
import { FILES } from "../lib/constants.mjs";
import { generateKeypair } from "../lib/keypair.mjs";
import { parseRelayUrls } from "../lib/relay.mjs";
import { logger } from "../utils/logger.mjs";
import {
  readJSONFile,
  writeJSONFile,
  fileExists,
  readTextFile,
  writeTextFile,
} from "../utils/fs.mjs";
import { handleError, ConfigError, ValidationError } from "../utils/errors.mjs";

dotenv.config();

const CONFIG_FILE = ".nweb.config.json";
const ENV_FILE = ".env";

/**
 * Default configuration schema
 */
const DEFAULT_CONFIG = {
  version: "1.0.0",
  site: {
    name: "",
    domain: "",
    description: "",
  },
  relays: {
    primary: [],
    fallback: [],
    timeout: 10000,
    retries: 3,
  },
  deployment: {
    autoVersion: true,
    versionStrategy: "semver",
    cleanBeforeDeploy: false,
    parallelUploads: true,
  },
  optimization: {
    minifyHtml: false,
    minifyCss: false,
    minifyJs: false,
    compressImages: false,
  },
  monitoring: {
    enabled: false,
    analytics: false,
    errorTracking: false,
  },
  advanced: {
    customEventKinds: {},
    customTags: {},
    maxFileSize: 50 * 1024,
  },
};

/**
 * Load configuration from file
 */
function loadConfig(dir = ".") {
  const configPath = path.join(dir, CONFIG_FILE);

  if (fileExists(configPath)) {
    try {
      return readJSONFile(configPath);
    } catch (error) {
      logger.warn(`⚠️  Failed to parse config file: ${error.message}`);
      return { ...DEFAULT_CONFIG };
    }
  }

  return { ...DEFAULT_CONFIG };
}

/**
 * Save configuration to file
 */
function saveConfig(config, dir = ".") {
  const configPath = path.join(dir, CONFIG_FILE);
  writeJSONFile(configPath, config);
}

/**
 * Interactive configuration wizard
 */
async function configWizard() {
  try {
    const rl = readline.createInterface({ input, output });

    logger.header("🧙 Nostr Web Configuration Wizard");
    logger.info("Configure your Nostr website project.\n");

    const config = { ...DEFAULT_CONFIG };

    // Site information
    logger.info("📝 Site Information");
    config.site.name = await rl.question("Site name: ");
    config.site.domain = await rl.question("Domain (e.g., example.com): ");
    config.site.description = await rl.question("Description: ");
    logger.info("");

    // Keypair
    logger.info("🔑 Keypair Setup");
    const hasKeypair = await rl.question(
      "Do you have a Nostr keypair? (y/n): "
    );

    let skHex = "";
    if (hasKeypair.toLowerCase() === "y") {
      const keyInput = await rl.question("Enter private key (nsec or hex): ");
      if (keyInput.startsWith("nsec1")) {
        const decoded = nip19.decode(keyInput);
        skHex = Buffer.from(decoded.data).toString("hex");
      } else {
        skHex = keyInput;
      }
    } else {
      logger.info("Generating new keypair...");
      const { privateKey, publicKey } = generateKeypair();
      skHex = privateKey;
      const npub = nip19.npubEncode(publicKey);
      logger.success("\n✓ Generated new keypair");
      logger.info(`  Public key: ${npub}`);
      logger.info(`  Private key: ${skHex.substring(0, 16)}...`);
    }
    logger.info("");

    // Relays
    logger.info("🔌 Relay Configuration");
    const relayInput = await rl.question(
      "Relay URLs (comma-separated) [wss://relay.nostr.band,wss://nos.lol]: "
    );
    const relays = relayInput || "wss://relay.nostr.band,wss://nos.lol";
    config.relays.primary = parseRelayUrls(relays);
    logger.info("");

    // Deployment options
    logger.info("🚀 Deployment Options");
    const autoVersion = await rl.question(
      "Auto-increment version? (y/n) [y]: "
    );
    config.deployment.autoVersion = autoVersion.toLowerCase() !== "n";
    logger.info("");

    rl.close();

    // Save configuration
    saveConfig(config);
    logger.success(`✓ Saved configuration to ${CONFIG_FILE}`);

    // Create .env file
    const envPath = path.join(process.cwd(), ENV_FILE);
    if (!fileExists(envPath)) {
      const envContent = `# Nostr Web Configuration
NOSTR_SK_HEX=${skHex}
RELAYS=${config.relays.primary.join(",")}
NWEB_HOST=${config.site.domain}
`;
      writeTextFile(envPath, envContent);
      logger.success(`✓ Created ${ENV_FILE}`);
    }

    logger.success("\n✅ Configuration complete!");
    logger.info("\n📝 Next steps:");
    logger.info("  1. Edit your site files (index.html, etc.)");
    logger.info("  2. Deploy: nweb deploy");
    logger.info("");
  } catch (error) {
    handleError(error);
  }
}

/**
 * Show current configuration
 */
function showConfig() {
  try {
    const config = loadConfig();

    logger.header("⚙️  Current Configuration");
    console.log(JSON.stringify(config, null, 2));
    logger.info("");
  } catch (error) {
    handleError(error);
  }
}

/**
 * Update configuration value
 */
function updateConfig(key, value) {
  try {
    const config = loadConfig();

    // Parse nested keys (e.g., "site.name")
    const keys = key.split(".");
    let current = config;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }

    // Try to parse value as JSON
    try {
      current[keys[keys.length - 1]] = JSON.parse(value);
    } catch {
      current[keys[keys.length - 1]] = value;
    }

    saveConfig(config);
    logger.success(`✓ Updated ${key} = ${value}`);
  } catch (error) {
    handleError(error);
  }
}

/**
 * Get configuration value
 */
function getConfigValue(key) {
  try {
    const config = loadConfig();

    const keys = key.split(".");
    let current = config;

    for (const k of keys) {
      if (current[k] === undefined) {
        throw new ValidationError(`Key not found: ${key}`);
      }
      current = current[k];
    }

    console.log(JSON.stringify(current, null, 2));
  } catch (error) {
    handleError(error);
  }
}

/**
 * Generate new keypair
 */
function generateKeypairCmd() {
  try {
    logger.header("🔑 Generating New Keypair");

    const { privateKey, publicKey } = generateKeypair();
    const npub = nip19.npubEncode(publicKey);
    const nsec = nip19.nsecEncode(Buffer.from(privateKey, "hex"));

    logger.info("\nPrivate Key (hex):");
    console.log(privateKey);
    logger.info("\nPrivate Key (nsec):");
    console.log(nsec);
    logger.info("\nPublic Key (npub):");
    console.log(npub);
    logger.info("");

    logger.warn(
      "⚠️  Keep your private key safe! Anyone with access can publish as you."
    );
    logger.info("\n💡 Add to .env file:");
    logger.info(`   NOSTR_SK_HEX=${privateKey}`);
    logger.info("");
  } catch (error) {
    handleError(error);
  }
}

/**
 * Validate configuration
 */
function validateConfig() {
  try {
    const config = loadConfig();
    const errors = [];
    const warnings = [];

    // Check required fields
    if (!config.site.domain) {
      warnings.push("Site domain not set");
    }

    if (!config.relays.primary || config.relays.primary.length === 0) {
      errors.push("No primary relays configured");
    }

    // Validate relay URLs
    if (config.relays.primary && config.relays.primary.length > 0) {
      try {
        parseRelayUrls(config.relays.primary.join(","));
      } catch (error) {
        errors.push(`Invalid relay URLs: ${error.message}`);
      }
    }

    // Check environment variables
    if (!process.env.NOSTR_SK_HEX) {
      errors.push("NOSTR_SK_HEX not set in .env");
    }

    if (!process.env.RELAYS) {
      warnings.push("RELAYS not set in .env");
    }

    // Display results
    logger.header("🔍 Configuration Validation");

    if (errors.length > 0) {
      logger.error("❌ Errors:");
      errors.forEach((err) => logger.info(`   - ${err}`));
      logger.info("");
    }

    if (warnings.length > 0) {
      logger.warn("⚠️  Warnings:");
      warnings.forEach((warn) => logger.info(`   - ${warn}`));
      logger.info("");
    }

    if (errors.length === 0 && warnings.length === 0) {
      logger.success("✅ Configuration is valid!\n");
    } else if (errors.length === 0) {
      logger.success("✅ Configuration is valid (with warnings)\n");
    } else {
      logger.error("❌ Configuration has errors\n");
      process.exit(1);
    }
  } catch (error) {
    handleError(error);
  }
}

/**
 * Main function
 */
async function main() {
  try {
    const args = process.argv.slice(2);

    // Show help
    if (
      args.length === 0 ||
      args.includes("--help") ||
      args.includes("-h") ||
      args[0] === "help"
    ) {
      console.log(`
⚙️  Nostr Web Configuration Manager

Manages project configuration, environment variables, and settings.

Usage: nweb config <command> [options]

Commands:
  wizard           Interactive configuration setup
  generate         Generate new keypair
  show             Display current configuration
  set <key> <val>  Set configuration value
  get <key>        Get configuration value
  validate         Validate configuration
  
Examples:
  # Run interactive setup
  nweb config wizard
  
  # Generate new keypair
  nweb config generate
  
  # Show current config
  nweb config show
  
  # Update specific values
  nweb config set site.domain example.com
  nweb config set relays.primary '["wss://relay1.com","wss://relay2.com"]'
  
  # Get specific values
  nweb config get relays.primary
  nweb config get site.domain
  
  # Validate configuration
  nweb config validate
`);
      return;
    }

    const [command, ...commandArgs] = args;

    switch (command) {
      case "wizard":
        await configWizard();
        break;

      case "generate":
        generateKeypairCmd();
        break;

      case "show":
        showConfig();
        break;

      case "set":
        if (commandArgs.length < 2) {
          throw new ValidationError("Usage: nweb config set <key> <value>");
        }
        updateConfig(commandArgs[0], commandArgs[1]);
        break;

      case "get":
        if (commandArgs.length < 1) {
          throw new ValidationError("Usage: nweb config get <key>");
        }
        getConfigValue(commandArgs[0]);
        break;

      case "validate":
        validateConfig();
        break;

      default:
        throw new ValidationError(
          `Unknown command: ${command}. Use --help for usage.`
        );
    }
  } catch (error) {
    handleError(error);
  }
}

// Run
main();
