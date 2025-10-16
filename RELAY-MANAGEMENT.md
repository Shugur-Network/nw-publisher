# Relay Management & Orphan Cleanup

## Overview

The publisher now implements comprehensive relay management with automatic rollback of orphaned events to ensure data consistency across all relays.

## Key Features

### 1. **Retry Logic**

- Each event is retried up to 3 times per relay
- 1-second delay between retry attempts
- Individual relay tracking prevents unnecessary retries on successful relays

### 2. **Orphan Event Cleanup**

When a relay fails to publish some (but not all) events:

- All successfully published events on that relay are automatically deleted
- Uses Nostr kind 5 (deletion) events with reason: "Rollback: Relay failed to publish all events for this site"
- Ensures relays either have the complete site or nothing at all

### 3. **DNS Filtering**

- Only relays with **100% publish success** are included in `_nweb.txt`
- Failed/partial relays are explicitly excluded with clear messaging
- Fallback to all relays only if none succeeded completely (with warning)

### 4. **Comprehensive Reporting**

#### Relay Status Display:

- ✅ **Success**: 100% publish rate
- ⚠️ **Partial Failure**: Some events failed (shows percentage)
- 🗑️ **Rolled Back**: Orphaned events automatically deleted
- ❌ **Connection Failed**: Could not connect to relay

#### Corrective Actions:

Actionable recommendations based on failure type:

- **Connection Failed**: Check relay status, network connectivity, consider removal
- **Rolled Back**: Events cleaned up, fix underlying issue, use reliable relay
- **0% Success**: Check event kind support, rate limits, relay policies
- **<50% Success**: Check rate/size limits, monitor intermittently
- **>50% Success**: Monitor specific failures, temporary issues

### 5. **Exit Codes**

- **Exit 0**: All relays successful OR minor warnings only
- **Exit 1**: Critical failures (connection failed, rolled back, <50% success)

## Example Output

```
🧹 Cleaning up orphaned events from failed relays...
   Found 1 relay(s) with failures:
   🗑️  wss://relay.damus.io: Deleting 5 orphaned event(s)...
      ✓ Deleted 5/5 event(s)

📡 RELAY PUBLISH SUMMARY
======================================================================

🗑️  wss://relay.damus.io
   Status: Rolled back (orphaned events deleted)
   Reason: Failed to publish complete site

✅ wss://relay.nostr.band
   Published: 7 event(s)
   Success Rate: 100%

✅ wss://nos.lol
   Published: 7 event(s)
   Success Rate: 100%

Summary: 2/3 relay(s) with 100% success
Total events published: 14
Total events failed: 0
```

## Implementation Details

### Tracking

- `publishLog`: Per-relay list of successfully published event IDs
- `relayStats`: Connection status, publish counts, failure counts, rollback flag

### Rollback Process

1. Identify relays with `stats.failed > 0`
2. For each failed relay:
   - Retrieve list of successfully published events from `publishLog`
   - Create and publish kind 5 deletion events
   - Update stats: `published = 0`, `failed = 0`, `rolledBack = true`
3. Failed relays excluded from DNS record

### DNS Record

Only includes relays where:

```javascript
stats.connected && stats.published > 0 && stats.failed === 0;
```

## Benefits

1. **Data Consistency**: No partial/incomplete sites on any relay
2. **User Experience**: Clients only query relays with complete site data
3. **Debugging**: Clear visibility into which relays work reliably
4. **Automatic Recovery**: No manual cleanup needed for failed publishes
5. **Production Ready**: Exit codes enable CI/CD integration

## Best Practices

- Use 3-5 reliable relays for redundancy
- Monitor relay health: https://nostr.watch/
- Test relays individually before production
- Review corrective actions after each publish
- Update `.env` file to remove consistently failing relays
