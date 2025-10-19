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
    description: "Remove events from relays (all or orphans only)",
    usage: "nweb cleanup [options]",
    options: {
      "--all, -a": "Delete all events (default)",
      "--orphans, -o": "Delete only orphaned events",
      "--relay <url>, -r": "Target specific relay(s)",
      "--dry-run, -d": "Preview without deleting",
    },
    examples: [
      "nweb cleanup",
      "nweb cleanup --orphans",
      "nweb cleanup --relay wss://relay.example.com",
      "nweb cleanup --orphans --relay wss://relay.example.com",
      "nweb cleanup --orphans --dry-run",
    ],
  },

  // Sync
  sync: {
    alias: ["synchronize"],
    description: "Ensure all versions exist on all relays",
    usage: "nweb sync",
    examples: ["nweb sync"],
  },

  // Configuration
  init: {
    alias: ["setup"],
    description: "Initialize a new Nostr website project",
    usage: "nweb init [directory]",
    examples: ["nweb init", "nweb init ./my-new-site"],
  },

  config: {
    alias: ["configure", "settings"],
    description: "Manage configuration",
    usage: "nweb config <command> [options]",
    subcommands: {
      show: "Show current configuration",
      set: "Set configuration value",
      get: "Get configuration value",
      generate: "Generate keypair",
    },
    examples: [
      "nweb config show",
      "nweb config set NWEB_HOST example.com",
      "nweb config get RELAYS",
      "nweb config generate",
    ],
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
║                 Tool for Nostr Website Management                 ║
╚═══════════════════════════════════════════════════════════════════╝

A comprehensive CLI tool for deploying, managing, and monitoring static
websites on the Nostr network.

USAGE
  nweb <command> [options]

CORE COMMANDS
  deploy          Deploy website to Nostr relays
  versions        Manage site versions and history
  cleanup         Remove events from relays (--all or --orphans)
  sync            Ensure all versions exist on all relays
  status          Check site and relay status

CONFIGURATION
  init            Initialize new Nostr website
  config          Manage configuration settings

COMMON WORKFLOWS
  # Initial setup
  nweb init my-site
  cd my-site
  nweb config generate
  nweb deploy

  # Version management
  nweb versions list
  nweb versions compare 1.0.0 1.1.0

  # Troubleshooting
  nweb status
  nweb sync
  nweb cleanup
  nweb deploy

GET HELP
  nweb help <command>     Show help for a specific command
  nweb --version          Show CLI version

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

    case "config":
      runScript("config-manager.mjs", args);
      break;

    case "init":
      await handleInit(args);
      break;

    default:
      console.error(`❌ Command not implemented: ${actualCommand}`);
      process.exit(1);
  }
}

/**
 * Initialize new Nostr website
 */
async function handleInit(args) {
  // Show help
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
🆕 Nostr Web Init

Initialize a new Nostr website project with boilerplate files.

Usage: nweb init [directory]

Arguments:
  directory         Target directory (default: current directory)

Examples:
  # Initialize in current directory
  nweb init
  
  # Create new project directory
  nweb init my-website
  nweb init ./sites/my-blog

What it creates:
  - index.html       Main HTML file
  - style.css        Basic stylesheet
  - app.js           JavaScript file
  - .env.example     Environment configuration template
  - .gitignore       Git ignore patterns

Next steps:
  1. cd <directory>
  2. nweb config generate    # Generate keypair
  3. cp .env.example .env    # Configure environment
  4. nweb deploy .           # Deploy to Nostr
`);
    process.exit(0);
  }

  const targetDir = args[0] || ".";
  const dirPath = join(process.cwd(), targetDir);

  console.log("🚀 Initializing Nostr website...\n");

  // Create directory if it doesn't exist
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`✓ Created directory: ${targetDir}`);
  }

  // Create basic HTML file
  const indexPath = join(dirPath, "index.html");
  if (!fs.existsSync(indexPath)) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Nostr Website</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <header>
        <h1>Welcome to Nostr Web</h1>
    </header>
    <main>
        <p>Your decentralized website is now live on Nostr!</p>
        <p>Edit <code>index.html</code> to customize your site.</p>
    </main>
    <footer>
        <p>Powered by Nostr Web Publisher</p>
    </footer>
    <script src="app.js"></script>
</body>
</html>`;
    fs.writeFileSync(indexPath, html);
    console.log("✓ Created index.html");
  }

  // Create basic CSS
  const cssPath = join(dirPath, "style.css");
  if (!fs.existsSync(cssPath)) {
    const css = `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.6;
    color: #333;
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
}

header {
    margin-bottom: 2rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid #8b5cf6;
}

h1 {
    color: #8b5cf6;
    font-size: 2.5rem;
}

main {
    margin: 2rem 0;
}

code {
    background: #f4f4f4;
    padding: 0.2rem 0.5rem;
    border-radius: 3px;
    font-family: "Courier New", monospace;
}

footer {
    margin-top: 3rem;
    padding-top: 1rem;
    border-top: 1px solid #ddd;
    color: #666;
    font-size: 0.9rem;
}`;
    fs.writeFileSync(cssPath, css);
    console.log("✓ Created style.css");
  }

  // Create basic JS
  const jsPath = join(dirPath, "app.js");
  if (!fs.existsSync(jsPath)) {
    const js = `console.log("🚀 Nostr Web loaded!");

// Add your JavaScript here
document.addEventListener("DOMContentLoaded", () => {
    console.log("Page ready!");
});`;
    fs.writeFileSync(jsPath, js);
    console.log("✓ Created app.js");
  }

  // Create .env.example
  const envExamplePath = join(dirPath, ".env.example");
  if (!fs.existsSync(envExamplePath)) {
    const envExample = `# Nostr private key (64-character hex)
NOSTR_SK_HEX=your_private_key_here

# Relay URLs (comma-separated)
RELAYS=wss://relay.nostr.band,wss://nos.lol,wss://relay.damus.io

# Your domain (for DNS TXT record)
NWEB_HOST=yourdomain.com`;
    fs.writeFileSync(envExamplePath, envExample);
    console.log("✓ Created .env.example");
  }

  // Create .gitignore
  const gitignorePath = join(dirPath, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    const gitignore = `.env
.nweb-cache.json
.nweb-keypair.json
node_modules/
_nweb.txt
_nweb.txt.json`;
    fs.writeFileSync(gitignorePath, gitignore);
    console.log("✓ Created .gitignore");
  }

  console.log("\n✅ Nostr website initialized!");
  console.log("\n📝 Next steps:");
  console.log("  1. Generate a keypair:    nweb config generate");
  console.log("  2. Configure relays:      cp .env.example .env");
  console.log("  3. Edit your site files:  index.html, style.css, app.js");
  console.log("  4. Deploy to Nostr:       nweb deploy");
  console.log("");
}

/**
 * Handle config commands
 */
async function handleConfig(args) {
  const subcommand = args[0];

  if (!subcommand || subcommand === "show") {
    await showConfig();
  } else if (subcommand === "set") {
    await setConfig(args[1], args[2]);
  } else if (subcommand === "get") {
    await getConfig(args[1]);
  } else if (subcommand === "generate") {
    await generateKeypair();
  } else {
    console.error(`❌ Unknown config subcommand: ${subcommand}`);
    showHelp("config");
  }
}

/**
 * Show current configuration
 */
async function showConfig() {
  const dotenv = await import("dotenv");
  dotenv.config();

  console.log("\n⚙️  Current Configuration\n");
  console.log("=".repeat(70));

  const vars = [
    { name: "NOSTR_SK_HEX", secret: true },
    { name: "RELAYS", secret: false },
    { name: "NWEB_HOST", secret: false },
  ];

  for (const { name, secret } of vars) {
    const value = process.env[name];
    if (value) {
      const display = secret ? `${value.substring(0, 8)}...` : value;
      console.log(`${name.padEnd(20)} ${display}`);
    } else {
      console.log(`${name.padEnd(20)} (not set)`);
    }
  }

  console.log("=".repeat(70) + "\n");
}

/**
 * Set configuration value
 */
async function setConfig(key, value) {
  if (!key || !value) {
    console.error("❌ Usage: nweb config set <KEY> <value>");
    process.exit(1);
  }

  const envPath = join(process.cwd(), ".env");
  let envContent = "";

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, "utf8");
  }

  const lines = envContent.split("\n");
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`${key}=`)) {
      lines[i] = `${key}=${value}`;
      found = true;
      break;
    }
  }

  if (!found) {
    lines.push(`${key}=${value}`);
  }

  fs.writeFileSync(envPath, lines.join("\n"));
  console.log(`✓ Set ${key}=${value}`);
}

/**
 * Get configuration value
 */
async function getConfig(key) {
  if (!key) {
    console.error("❌ Usage: nweb config get <KEY>");
    process.exit(1);
  }

  const dotenv = await import("dotenv");
  dotenv.config();

  const value = process.env[key];
  if (value) {
    console.log(value);
  } else {
    console.error(`❌ ${key} not found in configuration`);
    process.exit(1);
  }
}

/**
 * Generate new keypair
 */
async function generateKeypair() {
  const { generateSecretKey, getPublicKey, nip19 } = await import(
    "nostr-tools"
  );

  console.log("\n🔑 Generating new Nostr keypair...\n");

  const SK = generateSecretKey();
  const skHex = Buffer.from(SK).toString("hex");
  const pubkey = getPublicKey(SK);
  const npub = nip19.npubEncode(pubkey);
  const nsec = nip19.nsecEncode(SK);

  console.log("Private Key (hex):");
  console.log(skHex);
  console.log("");
  console.log("Private Key (nsec):");
  console.log(nsec);
  console.log("");
  console.log("Public Key (npub):");
  console.log(npub);
  console.log("");

  console.log(
    "⚠️  Keep your private key safe! Anyone with access can publish as you."
  );
  console.log("\n💡 Add to .env file:");
  console.log(`   NOSTR_SK_HEX=${skHex}`);
  console.log("");
}

// Run CLI
main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
