# Nostr Web Publisher - Usage Guide

## Quick Start

All commands can now run **without any arguments** if you have `NOSTR_SK_HEX` configured in your `.env` file!

## Publishing

### Publish a site

```bash
# Publish specific site directory
node publish.mjs examples/hello-world

# The site directory is required for publishing
# (needs access to HTML/CSS/JS files and keypair)
```

## Version Management

### List all versions

```bash
# Using .env private key (simplest)
node versions.mjs list

# Using npub (query any site)
node versions.mjs list npub1tm2kg4mzmug7nsw7pvjkqglrr4npwj2rugaymp43prgcfg2cgwlscxmv77

# Using site directory (backward compatible)
node versions.mjs list examples/hello-world
```

### Show version details

```bash
# Using .env
node versions.mjs show 0.2.0

# Using npub
node versions.mjs show npub1... 0.2.0

# Using site directory
node versions.mjs show examples/hello-world 0.2.0
```

### Compare versions

```bash
# Using .env
node versions.mjs compare 0.1.0 0.2.0

# Using npub
node versions.mjs compare npub1... 0.1.0 0.2.0

# Using site directory
node versions.mjs compare examples/hello-world 0.1.0 0.2.0
```

### Show current version

```bash
# Using .env
node versions.mjs current

# Using npub
node versions.mjs current npub1...

# Using site directory
node versions.mjs current examples/hello-world
```

## Cleanup

### Delete all published events

```bash
# Using .env private key (simplest)
node cleanup.mjs

# Using site directory (backward compatible)
node cleanup.mjs examples/hello-world
```

**Note:** You will be prompted to type "DELETE" to confirm.

## Configuration

### Required Environment Variables

Create a `.env` file in the project root:

```env
# Private key (hex format, 64 characters)
NOSTR_SK_HEX=your_private_key_here

# Relay URLs (comma-separated)
RELAYS=wss://relay.nostr.band,wss://nos.lol,wss://relay.snort.social
```

### Site Directory Structure

Each site directory should contain:

- `index.html` - Main HTML file
- Optional: `.nweb-keypair.json` - Site-specific keypair (if not using env var)
- Optional: CSS, JS, images, and other assets

## Architecture Benefits

### One Website Per Public Key

- Each public key (npub) publishes exactly one website
- No need to specify site location for querying versions
- Site directory only needed for publishing (to access files)

### Decentralized Version History

- Version history stored entirely on Nostr relays
- No local version files needed
- Query any site's version history with just their npub

### Flexible Identity Management

- Use environment variable for single-site projects
- Use site-specific keypairs for multi-site projects
- Query any site without local files

## Common Workflows

### Daily Development

```bash
# 1. Make changes to your site
# 2. Publish
node publish.mjs examples/hello-world

# 3. Check versions
node versions.mjs list

# 4. Compare with previous version
node versions.mjs compare 0.1.0 0.2.0
```

### Troubleshooting

```bash
# 1. Clean up all published events
node cleanup.mjs

# 2. Verify cleanup
node versions.mjs list

# 3. Republish
node publish.mjs examples/hello-world
```

### Inspecting Other Sites

```bash
# Query any site's version history (no local files needed!)
node versions.mjs list npub1example...
node versions.mjs show npub1example... 1.0.0
node versions.mjs compare npub1example... 0.9.0 1.0.0
```

## Exit Codes

- `0` - Success or warnings only
- `1` - Critical failure (no events published, connection failures, etc.)

## Features

✅ **Automatic Version Control** - Semantic versioning with automatic increment  
✅ **Retry Logic** - 3 attempts per relay with exponential backoff  
✅ **Automatic Rollback** - Failed relays cleaned up automatically  
✅ **DNS Filtering** - Only 100% successful relays included in DNS records  
✅ **Content Addressing** - SHA-256 hashes for all content  
✅ **Relay-Based History** - No local version files needed  
✅ **Flexible Identity** - Multiple ways to provide keypair

## Event Kinds

- `1125` - Assets (Regular) - HTML, CSS, JS, images
- `1126` - Manifests (Regular) - Links assets per page
- `31126` - Site Index (Addressable) - Maps routes, tagged by content hash
- `11126` - Entrypoint (Replaceable) - Points to current site index

## See Also

- [Quick Reference](QUICK-REFERENCE.md) - One-page cheat sheet
- [Relay Management](RELAY-MANAGEMENT.md) - Technical details on retry/rollback
- [Cleanup Guide](CLEANUP.md) - Detailed cleanup documentation
