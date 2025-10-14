# Nostr Web Publisher (nw-publish)

[![npm version](https://img.shields.io/npm/v/nw-publish.svg)](https://www.npmjs.com/package/nw-publish)
[![npm downloads](https://img.shields.io/npm/dm/nw-publish.svg)](https://www.npmjs.com/package/nw-publish)

CLI tool to publish static websites as Nostr events

Converts a static site folder into signed Nostr events (kinds 40000-40003 for assets, 34235-34236 for metadata) with SHA256 content hashes, then publishes to Nostr relays.

---

## Features

- 📦 **Publishes static sites as Nostr events** (HTML, CSS, JS, components)
- 🔒 **Content-addressed with SHA256** (required for all assets)
- 📝 **Always updates addressable events** with fresh timestamps
- 🔗 **Multi-relay publishing** with parallel uploads
- 💾 **Smart caching** (reuses unchanged assets between publishes)
- 📄 **DNS TXT record generation** (ready to paste)

---

## Installation

### npm (Recommended)

Install globally from npm:

```bash
npm install -g nw-publish
```

This creates a global `nw-publish` command you can use anywhere.

### From Source

If you want to contribute or need the latest development version:

```bash
git clone https://github.com/Shugur-Network/nostr-web.git
cd nostr-web/publisher
npm install
npm link
```

---

## Quick Start

### 1. Install

```bash
npm install -g nw-publish
```

### 2. Set Up Environment Variables

You can use a `.env` file or export environment variables:

**Option A: Using .env file** (create in your site directory)

```bash
# Required: Your Nostr private key (64-character hex)
NOSTR_SK_HEX="your_private_key_hex_here"

# Required: Relay URLs (comma-separated)
RELAYS="wss://shu01.shugur.net,wss://shu02.shugur.net,wss://shu03.shugur.net"

# Recommended: Your domain (for DNS TXT record generation)
NWEB_HOST="yourdomain.com"

# Optional: Blossom endpoints for media uploads
BLOSSOM_ENDPOINTS="https://blossom.shugur.net"
```

**Option B: Export environment variables**

```bash
export NOSTR_SK_HEX="your_private_key_hex"
export RELAYS="wss://relay1.com,wss://relay2.com"
export NWEB_HOST="yourdomain.com"
```

**⚠️ Security:** Never commit `.env` to version control!

### 3. Publish Your Site

```bash
nw-publish /path/to/your/site
```

Example:

```bash
nw-publish ./my-website
```

### 4. Set Up DNS

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
  │     ├─> Kind 40000: HTML content
  │     ├─> Kind 40001: CSS stylesheets
  │     ├─> Kind 40002: JavaScript modules
  │     └─> Kind 40003: Reusable components
  ├─> Publish to relays (parallel)
  ├─> Create page manifests (kind 34235)
  └─> Update site index (kind 34236)
```

### Smart Caching

**Immutable assets** (40000-40003) are cached:

- **Cache file:** `.nweb-cache.json` (in site folder)
- **Cache key:** `${filepath}:${hash}` (content-addressed)
- **Behavior:** If file unchanged, reuses cached event ID
- **Benefit:** Only publishes new/changed assets

**Addressable events** (34235, 34236) are **always republished** with fresh `created_at` timestamps, even if content unchanged. This ensures:

- Extension detects which site is newest
- Multiple sites with same pubkey stay synchronized
- DNS changes propagate immediately

### SHA256 Integrity

All assets include SHA256 tags for verification:

```json
{
  "kind": 40000,
  "tags": [
    ["path", "/index.html"],
    ["type", "text/html"],
    ["sha256", "abc123..."]
  ],
  "content": "<!DOCTYPE html>..."
}
```

---

## Usage Examples

### Basic Publish

```bash
nw-publish /path/to/site
```

Output:

```
✓ Using keypair from NOSTR_SK_HEX
📝 Processing assets...
[CACHED] 4 assets (unchanged)
✅ Assets: 4 reused, 0 published

📋 Processing manifests...
[MANIF] / -> 6759a7d4... (republished, content unchanged)

🗂️  Updating site index...
[INDEX] site-index -> 34830dba... (updated)

📄 Wrote _nweb.txt
```

### Force Full Republish

```bash
# Delete cache to republish all assets
rm /path/to/site/.nweb-cache.json
nw-publish /path/to/site
```

### Custom Relays

```bash
RELAYS="wss://custom-relay.example.com" nw-publish /path/to/site
```

### Multi-Site Publishing

```bash
# Same pubkey, different sites
nw-publish ../examples/hello-world
nw-publish ../examples/nostr-web-info

# Extension loads newest by created_at timestamp
```

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

- Asset events (40000-40003) → HTML, CSS, JS, components
- Page manifests (34235) → Per-route metadata
- Site index (34236) → Route mapping

---

## Environment Variables

| Variable            | Required       | Description                     | Example                      |
| ------------------- | -------------- | ------------------------------- | ---------------------------- |
| `NOSTR_SK_HEX`      | ✅ Yes         | Nostr private key (64-char hex) | `a1b2c3d4...`                |
| `RELAYS`            | ✅ Yes         | Comma-separated relay URLs      | `wss://shu01.shugur.net,...` |
| `NWEB_HOST`         | ⚠️ Recommended | Your domain                     | `yourdomain.com`             |
| `BLOSSOM_ENDPOINTS` | ❌ Optional    | Media upload endpoints          | `https://blossom.shugur.net` |

---

## Troubleshooting

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

### Site Not Loading

**Check:**

1. DNS TXT record at `_nweb.<yourdomain.com>`
2. JSON format valid
3. Pubkey in DNS matches events
4. Extension v0.9.6+ (fetches site index fresh)

---

## Protocol Details

### Event Kinds

| Kind  | Name          | Type        | Purpose                |
| ----- | ------------- | ----------- | ---------------------- |
| 40000 | HTML          | Immutable   | Page content           |
| 40001 | CSS           | Immutable   | Stylesheets            |
| 40002 | JS            | Immutable   | JavaScript             |
| 40003 | Components    | Immutable   | Reusable snippets      |
| 34235 | Page Manifest | Replaceable | Links assets per route |
| 34236 | Site Index    | Replaceable | Maps routes            |

**Immutable events** (40000-40003):

- Content-addressed by SHA256
- Cached indefinitely
- Never republished if unchanged

**Replaceable events** (34235, 34236):

- Identified by `["d"]` tag (NIP-33)
- Always republished with fresh `created_at`
- Relays keep only newest version

### Tag Structure

**Assets:**

```json
{
  "kind": 40000,
  "tags": [
    ["path", "/index.html"],
    ["type", "text/html"],
    ["sha256", "abc123..."],
    ["size", "1234"]
  ]
}
```

**Page Manifest:**

```json
{
  "kind": 34235,
  "tags": [
    ["d", "/"],
    ["title", "Home"],
    ["e", "html_id", "", "html"],
    ["e", "css_id", "", "css"],
    ["e", "js_id", "", "js"]
  ]
}
```

**Site Index:**

```json
{
  "kind": 34236,
  "tags": [
    ["d", "site-index"],
    ["e", "manifest_id", "", "/"],
    ["host", "yourdomain.com"]
  ]
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
