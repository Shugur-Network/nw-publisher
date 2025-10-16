# Quick Reference Guide

## Scripts

### Publish Site

```bash
node publish.mjs <site-folder>
```

Publishes your static site to Nostr relays with automatic retry and rollback.

### Cleanup Site

```bash
node cleanup.mjs <site-folder>
```

Deletes all published events from relays (useful for troubleshooting).

## Key Features

### 🔄 Automatic Retry

- Events retry up to 3 times per relay
- 1-second delay between attempts
- Individual relay tracking

### 🧹 Automatic Rollback

- If a relay fails to publish some events, ALL its events are deleted
- Ensures relays have complete site or nothing
- No orphaned/incomplete data

### 📡 Smart DNS Records

- Only 100% successful relays included in `_nweb.txt`
- Failed relays automatically excluded
- Fallback to all relays if none succeed completely

### 📊 Detailed Reporting

- Per-relay statistics (published/failed/success rate)
- Corrective actions for failures
- Exit code 1 for critical issues, 0 for success/warnings

## Event Kinds (NIP-XX)

| Kind  | Name       | Type        | Description                  |
| ----- | ---------- | ----------- | ---------------------------- |
| 1125  | Asset      | Regular     | HTML, CSS, JS files          |
| 1126  | Manifest   | Regular     | Links assets for each page   |
| 31126 | Site Index | Addressable | Maps routes to manifests     |
| 11126 | Entrypoint | Replaceable | Points to current site index |

## Workflow Examples

### First Publish

```bash
# Configure environment
cp .env.example .env
# Edit .env with your NOSTR_SK_HEX and RELAYS

# Publish site
node publish.mjs examples/hello-world

# Follow instructions in _nweb.txt to set DNS record
```

### Update Site

```bash
# Edit your content
vim examples/hello-world/index.html

# Republish (only changed files are re-uploaded)
node publish.mjs examples/hello-world
```

### Troubleshooting

```bash
# Clean up everything
node cleanup.mjs examples/hello-world

# Republish fresh
node publish.mjs examples/hello-world
```

### Testing

```bash
# Clean state
node cleanup.mjs examples/hello-world

# Test publish
node publish.mjs examples/hello-world

# Verify in browser with Nostr Web extension
```

## Configuration Files

### `.env` (required)

```bash
NOSTR_SK_HEX=your_64_char_hex_private_key
RELAYS=wss://relay.nostr.band,wss://nos.lol,wss://relay.damus.io
NWEB_HOST=yourdomain.com  # optional
```

### `.nweb-keypair.json` (auto-generated)

Created in site directory if NOSTR_SK_HEX not set.
Contains site's private/public keys.

### `.nweb-cache.json` (auto-generated)

Tracks published events to avoid re-uploading unchanged files.

### `_nweb.txt` (auto-generated)

Contains DNS TXT record instructions with relay filtering.

## Relay Status Icons

- ✅ **100% success** - All events published successfully
- ⚠️ **Partial failure** - Some events failed (shows %)
- 🗑️ **Rolled back** - Orphaned events deleted, relay excluded from DNS
- ❌ **Connection failed** - Could not connect to relay

## Exit Codes

- **0**: Success or minor warnings
- **1**: Critical failures (connection failed, <50% success, rolled back)

## Common Issues

### Rate Limited

**Symptom**: `rate-limited: you are noting too much`
**Solution**:

- Wait a few minutes
- Script auto-retries 3 times
- Failed relay excluded from DNS automatically

### Connection Failed

**Symptom**: `Failed to connect to wss://...`
**Solution**:

- Check network connectivity
- Verify relay URL
- Try different relay from https://nostr.watch/
- Failed relay excluded from DNS automatically

### Incomplete Publish

**Symptom**: Some events published, some failed
**Solution**:

- Script automatically deletes orphaned events
- Failed relay excluded from DNS
- Check corrective actions in output

### Start Fresh

```bash
node cleanup.mjs <site-folder>
node publish.mjs <site-folder>
```

## Documentation

- [RELAY-MANAGEMENT.md](./RELAY-MANAGEMENT.md) - Retry, rollback, and DNS filtering details
- [CLEANUP.md](./CLEANUP.md) - Full cleanup script documentation
- [README.md](./README.md) - Complete project documentation

## Best Practices

1. **Use 3-5 reliable relays** for redundancy
2. **Monitor relay health** at https://nostr.watch/
3. **Review corrective actions** after each publish
4. **Test on staging relays** before production
5. **Keep backups** of important sites
6. **Use cleanup tool** when troubleshooting

## Quick Commands

```bash
# Publish
node publish.mjs examples/hello-world

# Cleanup
node cleanup.mjs examples/hello-world

# Fresh republish
node cleanup.mjs examples/hello-world && node publish.mjs examples/hello-world

# Check errors only
node publish.mjs examples/hello-world 2>&1 | grep -E '(Error|Failed|Warning)'
```
