/**
 * Application Constants
 *
 * Centralized constants for event kinds, file names, timeouts, and other configuration values.
 */

// Nostr Event Kinds (NIP-XX)
export const EVENT_KINDS = {
  ASSET: 1125,
  MANIFEST: 1126,
  SITE_INDEX: 31126,
  ENTRYPOINT: 11126,
  DELETION: 5,
};

// File System
export const FILES = {
  KEYPAIR: ".nweb-keypair.json",
  CONFIG: ".nweb.config.json",
  DNS_OUTPUT: "_nweb.txt",
  DNS_JSON: "_nweb.txt.json",
  ENV: ".env",
  ENV_EXAMPLE: ".env.example",
  GITIGNORE: ".gitignore",
};

// Network Configuration
export const NETWORK = {
  RELAY_TIMEOUT: 30000, // 30 seconds
  PUBLISH_TIMEOUT: 10000, // 10 seconds
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // 1 second
  BACKOFF_MULTIPLIER: 2,
};

// Validation Limits
export const LIMITS = {
  MAX_FILE_SIZE: 50 * 1024, // 50KB
  MAX_RELAY_COUNT: 10,
  MIN_RELAY_COUNT: 1,
};

// Version Configuration
export const VERSION = {
  STRATEGY_SEMVER: "semver",
  STRATEGY_TIMESTAMP: "timestamp",
  STRATEGY_MANUAL: "manual",
};

// HTTP Status Codes (for future use)
export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  SERVER_ERROR: 500,
};

// Exit Codes
export const EXIT_CODES = {
  SUCCESS: 0,
  ERROR: 1,
};

// Default Relays
export const DEFAULT_RELAYS = [
  "wss://relay.nostr.band",
  "wss://nos.lol",
  "wss://relay.snort.social",
];

// MIME Types
export const MIME_TYPES = {
  HTML: "text/html",
  CSS: "text/css",
  JS: "text/javascript",
  JSON: "application/json",
  PNG: "image/png",
  JPG: "image/jpeg",
  SVG: "image/svg+xml",
};

// Template Files
export const TEMPLATES = {
  INDEX_HTML: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Nostr Website</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1>Welcome to Nostr Web</h1>
  <p>This is your decentralized website hosted on Nostr!</p>
  <script src="app.js"></script>
</body>
</html>`,

  STYLE_CSS: `body {
  font-family: system-ui, -apple-system, sans-serif;
  line-height: 1.6;
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem;
  color: #333;
}

h1 {
  color: #5b21b6;
}`,

  APP_JS: `console.log('Welcome to Nostr Web!');

// Your JavaScript code here
`,

  GITIGNORE: `# Dependencies
node_modules/

# Environment
.env
.env.local

# Cache
.nweb-cache.json

# Keypair (if using site-specific keys)
.nweb-keypair.json

# Build output
dist/
build/

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo
`,

  ENV_EXAMPLE: `# Nostr Web Configuration

# Private key (hex format, 64 characters)
# Generate with: nw-publisher config generate
NOSTR_SK_HEX=

# Relay URLs (comma-separated)
RELAYS=wss://relay.nostr.band,wss://nos.lol,wss://relay.snort.social

# Your domain (for DNS TXT record)
NWEB_HOST=
`,
};
