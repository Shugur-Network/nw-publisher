# Nostr Web Publisher

[![npm version](https://img.shields.io/npm/v/nw-publisher.svg)](https://www.npmjs.com/package/nw-publisher)
[![npm downloads](https://img.shields.io/npm/dm/nw-publisher.svg)](https://www.npmjs.com/package/nw-publisher)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> 🚀 **Publish and manage static websites on the Nostr network** - Deploy, version, monitor, and maintain decentralized websites with a comprehensive CLI toolkit.

**Nostr Web Publisher** (`nw-publisher`) is a full-featured CLI tool for managing static websites on Nostr. Deploy sites as signed Nostr events, track versions, monitor relay status, sync across relays, and clean up old deployments - all from one command-line interface.

**Browser Extension:** To view sites published with `nw-publisher`, install the Nostr Web Browser extension:

- **Chrome:** <https://chromewebstore.google.com/detail/nostr-web-browser/hhdngjdmlabdachflbdfapkogadodkif>
- **Firefox:** <https://addons.mozilla.org/en-US/firefox/addon/nostr-web-browser/>

---

## Features

- 📦 **Deploy static sites** - Publish HTML, CSS, JS to Nostr relays
- 🔒 **Content-addressed** - SHA256 hashes for all assets
- 📝 **Version management** - Track, compare, and query site versions
- 🔗 **Multi-relay publishing** - Parallel uploads with retry logic
- 💾 **Smart caching** - Reuse unchanged assets between deploys
- 🔄 **Cross-relay sync** - Ensure all relays have complete data
- 🧹 **Event cleanup** - Remove old or orphaned events
- 📊 **Status monitoring** - Check relay connectivity and site health
- 📄 **DNS TXT generation** - Ready-to-paste records for your domain

---

## Installation

### npm (Recommended)

Install globally from npm:

```bash
npm install -g nw-publisher
```

This installs the `nw-publisher` command globally.

### From Source

If you want to contribute or need the latest development version:

```bash
git clone https://github.com/Shugur-Network/nw-publisher.git
cd nw-publisher
npm install
npm link
```

---

## Quick Start

### 1. Install

```bash
npm install -g nw-publisher
```

### 2. Create Your Site

Create your HTML/CSS/JS files in a directory:

```bash
mkdir my-website
cd my-website
# Create index.html, style.css, etc.
```

### 3. Configure Environment

Generate a Nostr keypair and create a `.env` file:

```bash
# Generate keypair with nostr-tools
npx nostr-tools keygen

# Create .env file with your private key
echo "NOSTR_SK_HEX=your_private_key_hex" > .env
echo "RELAYS=wss://relay.damus.io,wss://nos.lol" >> .env
```

### 4. Deploy Your Site

```bash
nw-publisher deploy .
```

### 5. Set Up DNS (Optional)

The publisher outputs `_nweb.txt` with instructions. Copy the JSON value into a TXT record:

```
Host: _nweb.yourdomain.com
Type: TXT
Value: {"pk":"npub1...","relays":["wss://relay.damus.io",...]}
```

---

## How It Works

### Publishing Flow

```
Static Site Folder
  ├─> Scan files (HTML, CSS, JS)
  ├─> Compute SHA256 hashes
  ├─> Sign as Nostr events
  │     └─> Kind 1125: All assets (HTML, CSS, JS, etc.)
  ├─> Publish to relays (parallel)
  ├─> Create page manifests (kind 1126)
  ├─> Update site index (kind 31126)
  └─> Update entrypoint (kind 11126)
```

### Smart Caching

**Immutable assets** (kind 1125) are deduplicated by querying relays:

- **Cache source:** Nostr relays (queries on every deploy)
- **Cache key:** `${kind}:${content-hash}` (content-addressed)
- **Behavior:** If file unchanged and found on relays, reuses cached event ID
- **Benefit:** Only publishes new/changed assets
- **Reliability:** Always reflects true relay state, no stale local files

**Addressable events** (31126 - Site Index) and **replaceable events** (11126 - Entrypoint) are **republished when content changes**. This ensures:

- Extension detects which site is newest
- Multiple sites with same pubkey stay synchronized
- DNS changes propagate immediately

### SHA256 Integrity

All assets include SHA256 tags for verification:

```json
{
  "kind": 1125,
  "tags": [
    ["m", "text/html"],
    ["x", "abc123..."],
    ["alt", "Home Page"]
  ],
  "content": "<!DOCTYPE html>..."
}
```

---

## Commands

### Core Commands

#### `nw-publisher deploy <site-folder>`

Deploy your website to Nostr relays.

**Options:**

- `--version=X.Y.Z` - Set a custom version (e.g., 2.0.0)
- `--rebuild-cache` - Force rebuild cache from relays

```bash
# Basic deployment
nw-publisher deploy .
nw-publisher deploy ./my-site
nw-publisher deploy examples/hello-world

# Deploy with custom version
nw-publisher deploy . --version=2.0.0

# Rebuild cache from relays
nw-publisher deploy . --rebuild-cache
```

**Version Management:**

- Without `--version`: Automatically increments based on changes
  - **patch** (0.0.x): Content changes only
  - **minor** (0.x.0): New routes added/removed
- With `--version`: Uses your specified version (format: X.Y.Z)

#### `nw-publisher status [npub|hex]`

Check relay connectivity and deployment status.

```bash
# Your site (uses .env)
nw-publisher status

# Another site (no private key needed)
nw-publisher status npub1abc123...
```

#### `nw-publisher versions <command> [npub|hex]`

Manage and query site versions.

```bash
nw-publisher versions list
nw-publisher versions show 1.0.0
nw-publisher versions compare 0.9.0 1.0.0
nw-publisher versions list npub1abc123...
```

#### `nw-publisher sync`

Ensure all versions exist on all configured relays.

```bash
nw-publisher sync
```

#### `nw-publisher cleanup [options]`

Remove events from Nostr relays (all events, orphaned events, or a specific version).

```bash
nw-publisher cleanup                    # Delete all events (with confirmation)
nw-publisher cleanup --version 0.1.0    # Delete a specific version
nw-publisher cleanup --orphans          # Delete orphaned events only
nw-publisher cleanup --dry-run          # Preview without deleting
nw-publisher cleanup --relay wss://...  # Target specific relay(s)
```

**Options:**

- `--all, -a` - Delete all events (default)
- `--orphans, -o` - Delete only orphaned events
- `--version <ver>, -v` - Delete a specific version and its assets
- `--relay <url>, -r` - Target specific relay(s) (can be used multiple times)
- `--dry-run, -d` - Show what would be deleted without deleting

### Usage Examples

#### Deploy a Website

```bash
nw-publisher deploy .
```

#### Check Status

```bash
# Your own site
nw-publisher status

# Another site
nw-publisher status npub1abc123...
```

#### Sync Across Relays

```bash
# After adding new relays
nw-publisher sync
```

#### Clean Up Old Deployments

```bash
# Preview what will be deleted
nw-publisher cleanup --orphans --dry-run

# Delete orphaned events
nw-publisher cleanup --orphans

# Delete a specific version
nw-publisher cleanup --version 0.1.0

# Delete version from specific relay
nw-publisher cleanup --version 0.2.0 --relay wss://relay.example.com
```

---

## Configuration

### Environment Variables

| Variable       | Required | Description                  | Example                |
| -------------- | -------- | ---------------------------- | ---------------------- |
| `NOSTR_SK_HEX` | Yes      | Nostr private key (hex)      | `a1b2c3d4...`          |
| `RELAYS`       | Yes      | Comma-separated relay URLs   | `wss://relay1.com,...` |
| `NWEB_HOST`    | No       | Your domain (for DNS record) | `yourdomain.com`       |

---

## File Structure

**Input (static site):**

```
my-site/
  ├─ index.html       # Home page
  ├─ style.css        # Stylesheet
  ├─ app.js           # JavaScript
  └─ about.html       # Subpage (optional)
```

**Output:**

```
my-site/
  ├─ _nweb.txt        # DNS setup instructions
  └─ _nweb.txt.json   # DNS TXT JSON (ready to paste)
```

**Published to Nostr:**

- Asset events (1125) → HTML, CSS, JS, fonts, images
- Page manifests (1126) → Per-route metadata
- Site index (31126) → Route mapping (addressable)
- Entrypoint (11126) → Points to current site index

---

## Environment Variables

| Variable       | Required       | Description                     | Example                      |
| -------------- | -------------- | ------------------------------- | ---------------------------- |
| `NOSTR_SK_HEX` | ✅ Yes         | Nostr private key (64-char hex) | `a1b2c3d4...`                |
| `RELAYS`       | ✅ Yes         | Comma-separated relay URLs      | `wss://shu01.shugur.net,...` |
| `NWEB_HOST`    | ⚠️ Recommended | Your domain                     | `yourdomain.com`             |

---

## Deployment Architecture

`nw-publisher` queries relays on every deployment to check for existing assets and versions:

- **Asset deduplication**: Content-addressed matching (SHA256) prevents re-uploading unchanged files
- **Version history**: Reconstructed from site index events (kind 31126) on relays
- **No local cache files**: Relays are the single source of truth
- **Multi-project safe**: Different projects can coexist without cache conflicts

**Why no local cache?**

- Local files can become stale after `clean --all` or manual deletions
- Multiple projects deploying to same pubkey would share/corrupt cache
- Relay queries are fast and ensure accuracy
- Simplifies workflows (no cache management needed)

**Benefits:**

- ✅ No dependency on local files
- ✅ Works across multiple machines
- ✅ Team members see the same state
- ✅ CI/CD doesn't need cache files
- ✅ Relays are the single source of truth

---

## Troubleshooting

### Cleanup Tool

If you need to reset your site, remove old versions, or clean up orphaned events:

```bash
# Delete everything (full reset)
nw-publisher cleanup --all

# Delete a specific version
nw-publisher cleanup --version 0.1.0

# Delete orphaned events only
nw-publisher cleanup --orphans

# Preview without deleting
nw-publisher cleanup --version 0.2.0 --dry-run
```

This will:

- Query events from configured relays
- Show summary of what will be deleted
- Ask for confirmation (type "DELETE")
- Send deletion requests (kind 5 events) to all relays
- Provide detailed deletion statistics per relay

**Cleanup Modes:**

- **`--all`**: Delete all events (full reset)
- **`--version <ver>`**: Delete a specific version and its assets
- **`--orphans`**: Delete only unreferenced events (orphaned assets/manifests)

See the cleanup help for more details: `nw-publisher cleanup --help`

### "Cannot find module 'nostr-tools'"

**Solution:** Run `npm install` first

### "NOSTR_SK_HEX not found"

**Solution:** Create `.env` file:

```bash
echo "NOSTR_SK_HEX=your_hex_key_here" > .env
```

### "Failed to publish to relays"

**Causes:**

1. Relays offline (try different relays)
2. Events too large (relay limits ~64KB)
3. Rate limiting (wait a few minutes)

**Solution:** Use the cleanup tool to remove orphaned events or do a full reset, then republish:

```bash
# Option 1: Clean up orphans only
nw-publisher cleanup --orphans
nw-publisher deploy <site-folder>

# Option 2: Full reset
nw-publisher cleanup --all
nw-publisher deploy <site-folder>
```

### Site Not Loading

**Check:**

1. DNS TXT record at `_nweb.<yourdomain.com>`
2. JSON format valid
3. Pubkey in DNS matches events
4. Nostr Web Browser extension installed ([Chrome](https://chromewebstore.google.com/detail/nostr-web-browser/hhdngjdmlabdachflbdfapkogadodkif) / [Firefox](https://addons.mozilla.org/en-US/firefox/addon/nostr-web-browser/))
5. Extension v0.9.6+ (fetches site index fresh)

**Reset:** If site is inconsistent, use cleanup tool:

```bash
# Clean up orphans
nw-publisher cleanup --orphans
nw-publisher deploy <site-folder>

# Or do a full reset
nw-publisher cleanup --all
nw-publisher deploy <site-folder>
```

---

## Protocol Details

### Event Kinds

| Kind    | Name          | Type        | Purpose                              |
| ------- | ------------- | ----------- | ------------------------------------ |
| `1125`  | Asset         | Regular     | All web assets (HTML, CSS, JS, etc.) |
| `1126`  | Page Manifest | Regular     | Links assets per page                |
| `31126` | Site Index    | Addressable | Maps routes (content-addressed)      |
| `11126` | Entrypoint    | Replaceable | Points to current site index         |

**Regular events** (1125, 1126):

- Content-addressed by SHA256 (via `x` tag)
- Immutable once published
- Cached indefinitely
- Never republished if unchanged

**Addressable event** (31126 - Site Index):

- Uses content-addressed `d` tag (first 7-12 chars of content hash)
- Different content = different event
- Each version is preserved on relays

**Replaceable event** (11126 - Entrypoint):

- Only latest event per author is kept
- Points to current site index via `a` tag
- Updated when site index changes

### Tag Structure

**Asset (Kind 1125):**

```json
{
  "kind": 1125,
  "tags": [
    ["m", "text/html"],
    ["x", "abc123..."],
    ["alt", "Home Page"]
  ],
  "content": "<!DOCTYPE html>..."
}
```

**Page Manifest (Kind 1126):**

```json
{
  "kind": 1126,
  "tags": [
    ["route", "/"],
    ["title", "Home"],
    ["e", "html_event_id", "wss://relay.example.com"],
    ["e", "css_event_id", "wss://relay.example.com"],
    ["e", "js_event_id", "wss://relay.example.com"]
  ],
  "content": ""
}
```

**Site Index (Kind 31126):**

```json
{
  "kind": 31126,
  "tags": [
    ["d", "a1b2c3d"],
    ["x", "a1b2c3d4e5f6...full-hash..."],
    ["alt", "main"]
  ],
  "content": "{
    \"/\": \"<manifest-event-id-1>\",
    \"/about\": \"<manifest-event-id-2>\"
  }"
}
```

**Entrypoint (Kind 11126):**

```json
{
  "kind": 11126,
  "tags": [["a", "31126:<pubkey>:a1b2c3d", "wss://relay.example.com"]],
  "content": ""
}
```

---

## Development

### Running Tests

```bash
npm test
```

### Watch Mode

```bash
npm run test:watch
```

### Coverage

```bash
npm run test:coverage
```
