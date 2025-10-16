# Cleanup Script Documentation

## Overview

`cleanup.mjs` is a troubleshooting tool that deletes all Nostr Web Pages events published by your site from all configured relays.

## Usage

```bash
node cleanup.mjs <site-folder>
```

### Example

```bash
node cleanup.mjs examples/hello-world
```

## What It Does

1. **Loads Configuration**

   - Reads your site's keypair (from `NOSTR_SK_HEX` env or `.nweb-keypair.json`)
   - Reads relay configuration from `NOSTR_RELAYS` in `.env`

2. **Queries All Events**

   - Searches for all events published by your site's pubkey
   - Event kinds searched:
     - `1125`: Assets (HTML, CSS, JS files)
     - `1126`: Page Manifests
     - `31126`: Site Index (addressable)
     - `11126`: Entrypoint (replaceable)

3. **Deletes Events**

   - Sends kind 5 (deletion) events to all relays
   - Per-relay tracking of deleted/failed events

4. **Cleans Cache**
   - Deletes `.nweb-cache.json` in the site directory
   - Forces fresh publish on next run

## Interactive Confirmation

The script requires explicit confirmation before deletion:

```
⚠️  WARNING: This action cannot be undone!
Type "DELETE" to confirm cleanup:
```

You must type exactly `DELETE` (all caps) to proceed.

## Example Output

```
🧹 Nostr Web Pages Cleanup Tool
======================================================================

This tool will delete ALL Nostr Web Pages events published by your site.
Event kinds to be deleted: 1125 (Assets), 1126 (Manifests), 31126 (Site Index), 11126 (Entrypoint)

⚠️  WARNING: This action cannot be undone!
⚠️  Deletion requests will be sent to all configured relays.
⚠️  Some relays may not honor deletion requests.

Site Public Key: npub1tm2kg4mzmug7nsw7pvjkqglrr4npwj2rugaymp43prgcfg2cgwlscxmv77

Configured relays: wss://relay.damus.io, wss://relay.nostr.band, wss://nos.lol

Type "DELETE" to confirm cleanup: DELETE

✓ Confirmed. Starting cleanup...

🔌 Connecting to 3 relay(s)...
   ✓ Connected to wss://relay.damus.io
   ✓ Connected to wss://relay.nostr.band
   ✓ Connected to wss://nos.lol
   Connected to 3/3 relay(s)

🔍 Querying events from relays...
   Querying wss://relay.damus.io...
      Found 0 event(s):
   Querying wss://relay.nostr.band...
      Found 7 event(s):
         - Kind 1125 (Assets): 4
         - Kind 1126 (Manifests): 1
         - Kind 31126 (Site Index): 1
         - Kind 11126 (Entrypoint): 1
   Querying wss://nos.lol...
      Found 7 event(s):
         - Kind 1125 (Assets): 4
         - Kind 1126 (Manifests): 1
         - Kind 31126 (Site Index): 1
         - Kind 11126 (Entrypoint): 1

   Total events found across all relays: 14

🗑️  Deleting events from relays...

   ✓ wss://relay.damus.io: No events to delete
   🗑️  wss://relay.nostr.band: Deleting 7 event(s)...
      ✓ Deleted 7/7 event(s)
   🗑️  wss://nos.lol: Deleting 7 event(s)...
      ✓ Deleted 7/7 event(s)

🗑️  Deleted cache file: .nweb-cache.json

======================================================================
📊 CLEANUP SUMMARY
======================================================================

✓ wss://relay.damus.io: No events
✅ wss://relay.nostr.band: 7/7 deleted successfully
✅ wss://nos.lol: 7/7 deleted successfully

======================================================================
Total: 14 event(s) deleted
======================================================================

✅ Cleanup complete!

📝 Notes:
   - Deletion requests have been sent to all relays
   - Some relays may not honor deletion requests immediately
   - Deleted events may still be cached by clients
   - You can now republish your site with: node publish.mjs examples/hello-world
```

## When To Use

### 1. **Testing & Development**

- Clean slate before testing new features
- Reset state between test runs
- Debug publishing issues

### 2. **Troubleshooting**

- Remove incomplete publishes after failures
- Clear orphaned events from previous versions
- Fix inconsistent state across relays

### 3. **Site Migration**

- Remove old site before publishing to new keypair
- Clean up when changing relay configuration
- Reset before major site restructuring

### 4. **Privacy/Security**

- Remove all traces of a site from relays
- Clean up after accidentally publishing sensitive content
- Delete test sites from production relays

## Important Notes

### Relay Behavior

⚠️ **Not all relays honor deletion requests**

- Some relays may ignore kind 5 (deletion) events
- Events may remain cached by other clients
- Deletion is not guaranteed to be permanent

### Best Practices

1. **Always confirm** what will be deleted before proceeding
2. **Backup important content** before cleanup
3. **Wait a few minutes** after cleanup before republishing
4. **Verify deletion** by checking relays manually if needed

### Limitations

- Cannot delete events published by other keypairs
- Cannot force relays to delete events immediately
- Cannot remove events from client caches
- Some relays may have retention policies that override deletions

## Workflow Example

### Scenario: Fix broken publish

```bash
# 1. Clean up broken publish
node cleanup.mjs examples/hello-world

# 2. Fix the issue (e.g., update content, fix relay config)
vim examples/hello-world/index.html

# 3. Republish fresh
node publish.mjs examples/hello-world
```

### Scenario: Start fresh for testing

```bash
# Clean up
node cleanup.mjs examples/hello-world

# Test publish
node publish.mjs examples/hello-world

# Verify results
# ... make changes ...

# Clean and retry
node cleanup.mjs examples/hello-world
node publish.mjs examples/hello-world
```

## Troubleshooting

### "No keypair found"

- Ensure `NOSTR_SK_HEX` is set in `.env`, OR
- Ensure `.nweb-keypair.json` exists in site directory

### "NOSTR_RELAYS not found"

- Check that `.env` file exists in current directory
- Verify `NOSTR_RELAYS` is configured with comma-separated URLs

### "Failed to connect to any relays"

- Check network connectivity
- Verify relay URLs are correct
- Try different relays from https://nostr.watch/

### "Failed to delete some events"

- Some relays may be rate-limiting deletions
- Try running the script again after a few minutes
- Some relays simply don't honor deletion requests (this is normal)

## Safety Features

1. **Explicit Confirmation**: Must type "DELETE" to proceed
2. **Clear Warnings**: Shows what will be deleted before confirmation
3. **Dry-run Display**: Shows found events before deleting
4. **Per-relay Tracking**: See exactly what was deleted from each relay
5. **Error Handling**: Continues even if some deletions fail

## Exit Codes

- **0**: Success (cleanup completed or cancelled)
- **1**: Error (configuration issue, connection failure, etc.)
