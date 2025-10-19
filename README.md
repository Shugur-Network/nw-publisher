# Nostr Web Publisher (nweb)

[![npm version](https://img.shields.io/npm/v/nw-publish.svg)](https://www.npmjs.com/package/nw-publish)
[![npm downloads](https://img.shields.io/npm/dm/nw-publish.svg)](https://www.npmjs.com/package/nw-publish)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> 🚀 **Publish and manage static websites on the Nostr network** - Deploy, version, monitor, and maintain decentralized websites with a comprehensive CLI toolkit.

**Nostr Web Publisher** (`nweb`) is a full-featured CLI tool for managing static websites on Nostr. Deploy sites as signed Nostr events, track versions, monitor relay status, sync across relays, and clean up old deployments - all from one command-line interface.

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
- ⚙️ **Configuration wizard** - Interactive setup for keys and relays
- 📄 **DNS TXT generation** - Ready-to-paste records for your domain

---

## Installation

### npm (Recommended)

Install globally from npm:

```bash
npm install -g nw-publish
```

This installs the `nweb` command globally.

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
npm install -g nw-publish
```

### 2. Initialize a New Site

```bash
nweb init my-website
cd my-website
```

### 3. Configure Environment

Generate a keypair and set up configuration:

```bash
# Generate new Nostr keypair
nweb config generate

# Or manually edit .env
cp .env.example .env
# Edit NOSTR_SK_HEX and RELAYS
```

### 4. Deploy Your Site

```bash
nweb deploy .
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

**Immutable assets** (kind 1125) are cached:

- **Cache file:** `.nweb-cache.json` (in site folder)
- **Cache key:** `${kind}:${content-hash}` (content-addressed)
- **Behavior:** If file unchanged, reuses cached event ID
- **Benefit:** Only publishes new/changed assets

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

#### `nweb deploy <site-folder>`

Deploy your website to Nostr relays.

**Options:**

- `--version=X.Y.Z` - Set a custom version (e.g., 2.0.0)
- `--rebuild-cache` - Force rebuild cache from relays

```bash
# Basic deployment
nweb deploy .
nweb deploy ./my-site
nweb deploy examples/hello-world

# Deploy with custom version
nweb deploy . --version=2.0.0

# Rebuild cache from relays
nweb deploy . --rebuild-cache
```

**Version Management:**

- Without `--version`: Automatically increments based on changes
  - **patch** (0.0.x): Content changes only
  - **minor** (0.x.0): New routes added/removed
- With `--version`: Uses your specified version (format: X.Y.Z)

#### `nweb status [npub|hex]`

Check relay connectivity and deployment status.

```bash
# Your site (uses .env)
nweb status

# Another site (no private key needed)
nweb status npub1abc123...
```

#### `nweb versions <command> [npub|hex]`

Manage and query site versions.

```bash
nweb versions list
nweb versions show 1.0.0
nweb versions compare 0.9.0 1.0.0
nweb versions list npub1abc123...
```

#### `nweb sync`

Ensure all versions exist on all configured relays.

```bash
nweb sync
```

#### `nweb cleanup [options]`

Remove events from Nostr relays.

```bash
nweb cleanup                    # Delete all (with confirmation)
nweb cleanup --orphans          # Delete orphaned events only
nweb cleanup --dry-run          # Preview without deleting
```

#### `nweb config <command>`

Manage configuration and settings.

```bash
nweb config wizard              # Interactive setup
nweb config generate            # Generate keypair
nweb config show                # Show configuration
nweb config validate            # Validate settings
```

#### `nweb init [directory]`

Initialize a new Nostr website project.

```bash
nweb init                       # Current directory
nweb init my-website            # New directory
```

### Usage Examples

#### Deploy a Website

```bash
nweb deploy .
```

#### Check Status

```bash
# Your own site
nweb status

# Another site
nweb status npub1abc123...
```

#### Sync Across Relays

```bash
# After adding new relays
nweb sync
```

#### Clean Up Old Deployments

```bash
# Preview what will be deleted
nweb cleanup --orphans --dry-run

# Delete orphaned events
nweb cleanup --orphans
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
  ├─ about.html       # Subpage (optional)
  └─ .nweb-cache.json # Cache (auto-generated)
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

## Cache Files (Optional)

`nweb` creates two local cache files in your site directory:

### `.nweb-cache.json` - Event Cache

- **Stores**: Asset event IDs, manifest IDs, site index data
- **Purpose**: Avoid re-publishing unchanged files (faster deployments)
- **Can be deleted**: Yes! The tool will query relays to rebuild the cache

### `.nweb-versions.json` - Version History

- **Stores**: List of all published versions with timestamps
- **Purpose**: Track deployment history, power `nweb versions` command
- **Can be deleted**: Yes! The tool will reconstruct history from relays

### Rebuilding from Relays

If cache files are missing or deleted, `nweb` automatically queries your configured relays to rebuild them:

```bash
# Normal deploy - uses cache if available, queries relays if not
nweb deploy .

# Force rebuild from relays (ignore local cache)
nweb deploy . --rebuild-cache
```

**Benefits of relay-based cache:**

- ✅ No dependency on local files
- ✅ Works across multiple machines
- ✅ Team members see the same state
- ✅ CI/CD doesn't need cache files
- ✅ Relays are the single source of truth

**Note**: Querying relays is slower than reading local cache (~5-10 seconds), so cache files speed up subsequent deployments. Add them to `.gitignore` (done automatically by `nweb init`).

---

## Troubleshooting

### Cleanup Tool

If you need to reset your site or remove all published events:

```bash
nweb cleanup
```

This will:

- Query all events published by your site from configured relays
- Send deletion requests (kind 5 events) to all relays
- Delete the local cache file
- Provide detailed summary of what was deleted

**Example:**

```bash
nweb cleanup
```

See [CLEANUP.md](./CLEANUP.md) for full documentation.

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

**Solution:** Use the cleanup tool to remove orphaned events, then republish:

```bash
nweb cleanup
nweb deploy <site-folder>
```

### Site Not Loading

**Check:**

1. DNS TXT record at `_nweb.<yourdomain.com>`
2. JSON format valid
3. Pubkey in DNS matches events
4. Extension v0.9.6+ (fetches site index fresh)

**Reset:** If site is inconsistent, use cleanup tool:

```bash
nweb cleanup
nweb deploy <site-folder>
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
