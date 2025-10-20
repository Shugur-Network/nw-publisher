#!/usr/bin/env node
/**
 * Nostr Web CLI - Tool for Nostr Website Management
 *
 * A comprehensive tool for deploying, managing, and monitoring websites on Nostr.
 */

import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COMMANDS = {
  // Deployment
  deploy: {
    alias: ["publish", "push"],
    description: "Deploy website to Nostr relays",
    usage: "nweb deploy [site-folder]",
    examples: ["nweb deploy ./my-site", "nweb deploy"],
  },

  // Version Control
  versions: {
    alias: ["version", "v"],
    description: "Manage site versions",
    usage: "nweb versions <command> [options]",
    subcommands: {
      list: "List all published versions",
      show: "Show version details",
      compare: "Compare two versions",
      current: "Show current version",
    },
    examples: [
      "nweb versions list",
      "nweb versions show 1.0.0",
      "nweb versions compare 0.9.0 1.0.0",
      "nweb versions current",
    ],
  },

  // Cleanup & Reset
  cleanup: {
    alias: ["clean", "reset", "delete"],
    description: "Remove events from relays",
    usage: "nweb cleanup [options]",
    options: {
      "--all, -a": "Delete all events (default)",
      "--orphans, -o": "Delete only orphaned events",
      "--version <ver>, -v": "Delete a specific version",
      "--relay <url>, -r": "Target specific relay(s)",
      "--dry-run, -d": "Preview without deleting",
    },
    examples: [
      "nweb cleanup",
      "nweb cleanup --version 0.1.0",
      "nweb cleanup --orphans",
      "nweb cleanup --relay wss://relay.example.com",
      "nweb cleanup --version 0.2.0 --dry-run",
    ],
  },

  // Sync
  sync: {
    alias: ["synchronize"],
    description: "Ensure all versions exist on all relays",
    usage: "nweb sync",
    examples: ["nweb sync"],
  },

  // Status & Info
  status: {
    alias: ["info", "stat"],
    description: "Show site status and relay connectivity",
    usage: "nweb status [npub|hex]",
    examples: ["nweb status", "nweb status npub1...", "nweb status abc123..."],
  },
};

/**
 * Show help message
 */
function showHelp(command = null) {
  if (command && COMMANDS[command]) {
    const cmd = COMMANDS[command];
    console.log(`\n📖 ${command.toUpperCase()} - ${cmd.description}\n`);
    console.log(`Usage: ${cmd.usage}\n`);

    if (cmd.options) {
      console.log("Options:");
      for (const [opt, desc] of Object.entries(cmd.options)) {
        console.log(`  ${opt.padEnd(25)} ${desc}`);
      }
      console.log("");
    }

    if (cmd.subcommands) {
      console.log("Subcommands:");
      for (const [sub, desc] of Object.entries(cmd.subcommands)) {
        console.log(`  ${sub.padEnd(12)} ${desc}`);
      }
      console.log("");
    }

    if (cmd.examples) {
      console.log("Examples:");
      cmd.examples.forEach((ex) => console.log(`  ${ex}`));
      console.log("");
    }

    if (cmd.alias && cmd.alias.length > 0) {
      console.log(`Aliases: ${cmd.alias.join(", ")}`);
      console.log("");
    }

    return;
  }

  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                      NOSTR WEB CLI (nweb)                         ║
║              Deploy Static Websites to Nostr Network              ║
╚═══════════════════════════════════════════════════════════════════╝

USAGE
  nweb <command> [options]

COMMANDS
  deploy <dir>             Deploy website to Nostr relays
  status [npub]            Check site and relay status
  versions <cmd>           Manage site versions (list, show, compare)
  sync                     Sync all versions across relays
  cleanup [options]        Remove events (--all, --orphans, or --version)

OPTIONS
  --help, -h               Show help for a command
  --version, -v            Show CLI version

EXAMPLES
  # Deploy a site
  nweb deploy ./my-site
  nweb deploy examples/hello-world

  # Check status
  nweb status
  nweb status npub1...

  # Version management
  nweb versions list
  nweb versions show 1.0.0
  nweb versions compare 0.9.0 1.0.0

  # Maintenance
  nweb sync                      # Sync versions across relays
  nweb cleanup --version 0.1.0   # Remove specific version
  nweb cleanup --orphans         # Remove orphaned events
  nweb cleanup --all             # Full reset

SETUP
  1. Create .env file with NOSTR_SK_HEX and RELAYS
  2. Create your HTML/CSS/JS files
  3. Run: nweb deploy .

  Need a keypair? Generate with:
    node -e "const k = require('nostr-tools'); const sk = k.generateSecretKey(); console.log(Buffer.from(sk).toString('hex'));"

DOCUMENTATION
  https://github.com/Shugur-Network/nw-publisher
`);
}

/**
 * Show version
 */
function showVersion() {
  const packageJson = JSON.parse(
    fs.readFileSync(join(__dirname, "package.json"), "utf8")
  );
  console.log(`nweb v${packageJson.version}`);
}

/**
 * Run a Node.js script
 * Looks for refactored commands in src/commands/ first, then falls back to root
 */
function runScript(scriptName, args = []) {
  // Try src/commands/ first (for refactored commands)
  let scriptPath = join(__dirname, "src", "commands", scriptName);

  // Fall back to root directory (for publish.mjs and other non-refactored scripts)
  if (!fs.existsSync(scriptPath)) {
    scriptPath = join(__dirname, scriptName);
  }

  if (!fs.existsSync(scriptPath)) {
    console.error(`❌ Script not found: ${scriptName}`);
    console.error(`   Looked in: src/commands/${scriptName} and ${scriptName}`);
    process.exit(1);
  }

  try {
    const result = spawn("node", [scriptPath, ...args], {
      stdio: "inherit",
      cwd: __dirname,
    });

    result.on("exit", (code) => {
      process.exit(code || 0);
    });

    result.on("error", (err) => {
      console.error(`❌ Failed to run ${scriptName}:`, err.message);
      process.exit(1);
    });
  } catch (err) {
    console.error(`❌ Error running ${scriptName}:`, err.message);
    process.exit(1);
  }
}

/**
 * Find command (including aliases)
 */
function findCommand(cmd) {
  if (COMMANDS[cmd]) return cmd;

  for (const [name, config] of Object.entries(COMMANDS)) {
    if (config.alias && config.alias.includes(cmd)) {
      return name;
    }
  }

  return null;
}

/**
 * Main CLI router
 */
async function main() {
  const [, , command, ...args] = process.argv;

  // No command or help
  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    if (args[0]) {
      showHelp(args[0]);
    } else {
      showHelp();
    }
    return;
  }

  // Version
  if (command === "--version" || command === "-v") {
    showVersion();
    return;
  }

  // Find actual command (resolve aliases)
  const actualCommand = findCommand(command);

  if (!actualCommand) {
    console.error(`❌ Unknown command: ${command}`);
    console.log(`Run 'nweb help' for usage information`);
    process.exit(1);
  }

  // Route to appropriate handler
  switch (actualCommand) {
    case "deploy":
      runScript("publish.mjs", args);
      break;

    case "versions":
      runScript("versions.mjs", args);
      break;

    case "cleanup":
      runScript("cleanup.mjs", args);
      break;

    case "sync":
      runScript("sync.mjs", args);
      break;

    case "status":
      runScript("status.mjs", args);
      break;

    default:
      console.error(`❌ Unknown command: ${actualCommand}`);
      console.error(`   Run 'nweb --help' to see available commands`);
      process.exit(1);
  }
}

// Run CLI
main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
