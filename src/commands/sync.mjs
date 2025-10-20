#!/usr/bin/env node
/**
 * Sync Command - Refactored Version
 *
 * Ensures all versions exist on all configured relays.
 * Identifies missing events and republishes them.
 */

import dotenv from "dotenv";
import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";

// Import refactored utilities
import { EVENT_KINDS } from "../lib/constants.mjs";
import { getPublicKeyFromPrivate } from "../lib/keypair.mjs";
import {
  connectToRelay,
  closeRelay,
  queryEvents,
  parseRelayUrls,
} from "../lib/relay.mjs";
import { groupEventsByKind, getEventId } from "../lib/events.mjs";
import { logger } from "../utils/logger.mjs";
import { handleError, ConfigError } from "../utils/errors.mjs";
import { nip19 } from "nostr-tools";

dotenv.config();

/**
 * Query all NIP events from a relay
 *
 * @param {string} relayUrl - Relay URL
 * @param {string} pubkey - Author public key
 * @returns {Promise<Array>} Array of events
 */
async function queryAllEvents(relayUrl, pubkey) {
  try {
    const relay = await connectToRelay(relayUrl);

    const kinds = [
      EVENT_KINDS.ASSET,
      EVENT_KINDS.MANIFEST,
      EVENT_KINDS.SITE_INDEX,
      EVENT_KINDS.ENTRYPOINT,
    ];

    const events = await queryEvents(relay, [{ kinds, authors: [pubkey] }]);
    closeRelay(relay);

    return events;
  } catch (error) {
    logger.warn(`Failed to query ${relayUrl}: ${error.message}`);
    return [];
  }
}

/**
 * Build comprehensive event map from all relays
 *
 * @param {Array<string>} relays - List of relay URLs
 * @param {string} pubkey - Author public key
 * @returns {Promise<Object>} Event map and relay map
 */
async function buildEventMap(relays, pubkey) {
  const eventMap = new Map();
  const relayMap = new Map();

  logger.info("\n🔍 Scanning relays for events...\n");

  for (const relayUrl of relays) {
    logger.info(`   Querying ${relayUrl}...`);

    const events = await queryAllEvents(relayUrl, pubkey);
    logger.info(`      Found ${events.length} events`);

    // Track which events exist on which relays
    for (const event of events) {
      const eventId = getEventId(event);

      if (!eventMap.has(eventId)) {
        eventMap.set(eventId, event);
      }

      if (!relayMap.has(eventId)) {
        relayMap.set(eventId, new Set());
      }
      relayMap.get(eventId).add(relayUrl);
    }
  }

  logger.info(`\n   Total unique events: ${eventMap.size}\n`);

  return { eventMap, relayMap };
}

/**
 * Identify missing events per relay
 *
 * @param {Map} eventMap - Map of event ID to event
 * @param {Map} relayMap - Map of event ID to relay set
 * @param {Array<string>} relays - List of relay URLs
 * @returns {Map} Map of relay URL to missing events
 */
function findMissingEvents(eventMap, relayMap, relays) {
  const missing = new Map();

  for (const relayUrl of relays) {
    missing.set(relayUrl, []);
  }

  for (const [eventId, event] of eventMap.entries()) {
    const presentRelays = relayMap.get(eventId) || new Set();

    for (const relayUrl of relays) {
      if (!presentRelays.has(relayUrl)) {
        missing.get(relayUrl).push(event);
      }
    }
  }

  return missing;
}

/**
 * Group events by version (based on site index)
 *
 * @param {Array} events - All events
 * @returns {Map} Map of version to version data
 */
function groupEventsByVersion(events) {
  const siteIndexes = events.filter((e) => e.kind === EVENT_KINDS.SITE_INDEX);
  const versions = new Map();

  for (const siteIndex of siteIndexes) {
    try {
      const content = JSON.parse(siteIndex.content);
      const version = content.version || "unknown";
      const dTag = siteIndex.tags.find((t) => t[0] === "d")?.[1] || "unknown";

      if (!versions.has(version)) {
        versions.set(version, {
          version,
          siteIndex,
          contentHash: dTag,
          manifestIds: new Set(),
          assetIds: new Set(),
          entrypointId: null,
        });
      }

      // Find related manifests and assets
      const manifestIds = Object.values(content.routes || {});
      for (const manifestId of manifestIds) {
        versions.get(version).manifestIds.add(manifestId);
      }
    } catch (e) {
      // Skip invalid events
      logger.debug(`Skipping invalid site index event: ${e.message}`);
    }
  }

  // Find entrypoints
  const entrypoints = events.filter((e) => e.kind === EVENT_KINDS.ENTRYPOINT);
  for (const entrypoint of entrypoints) {
    const aTag = entrypoint.tags.find((t) => t[0] === "a")?.[1];
    if (aTag) {
      for (const [version, data] of versions.entries()) {
        if (aTag.includes(data.contentHash)) {
          data.entrypointId = getEventId(entrypoint);
          break;
        }
      }
    }
  }

  // Find manifests and their assets
  const manifests = events.filter((e) => e.kind === EVENT_KINDS.MANIFEST);
  for (const manifest of manifests) {
    const manifestId = getEventId(manifest);
    for (const [version, data] of versions.entries()) {
      if (data.manifestIds.has(manifestId)) {
        // Extract asset IDs from manifest
        const eTags = manifest.tags.filter((t) => t[0] === "e");
        for (const tag of eTags) {
          data.assetIds.add(tag[1]);
        }
      }
    }
  }

  return versions;
}

/**
 * Get friendly name for event kind
 *
 * @param {number} kind - Event kind
 * @returns {string} Kind name
 */
function getKindName(kind) {
  const names = {
    [EVENT_KINDS.ASSET]: "Assets",
    [EVENT_KINDS.MANIFEST]: "Manifests",
    [EVENT_KINDS.SITE_INDEX]: "Site Index",
    [EVENT_KINDS.ENTRYPOINT]: "Entrypoint",
  };
  return names[kind] || `Kind ${kind}`;
}

/**
 * Sync events to a specific relay
 *
 * @param {string} relayUrl - Relay URL
 * @param {Array} events - Events to publish
 * @returns {Promise<Object>} Sync results
 */
async function syncToRelay(relayUrl, events) {
  logger.info(`\n📤 Syncing to ${relayUrl}...`);

  try {
    const relay = await connectToRelay(relayUrl);

    let success = 0;
    let failed = 0;

    // Sort events by kind (assets first, then manifests, then indexes, then entrypoints)
    const kindOrder = {
      [EVENT_KINDS.ASSET]: 1,
      [EVENT_KINDS.MANIFEST]: 2,
      [EVENT_KINDS.SITE_INDEX]: 3,
      [EVENT_KINDS.ENTRYPOINT]: 4,
    };

    const sorted = events.sort((a, b) => {
      return (kindOrder[a.kind] || 99) - (kindOrder[b.kind] || 99);
    });

    for (const event of sorted) {
      try {
        await relay.publish(event);
        success++;
        process.stdout.write(".");
      } catch (e) {
        failed++;
        process.stdout.write("✗");
        logger.debug(
          `Failed to publish event ${getEventId(event)}: ${e.message}`
        );
      }
    }

    logger.info(`\n   ✓ Published: ${success}/${events.length}`);
    if (failed > 0) {
      logger.warn(`   ✗ Failed: ${failed}`);
    }

    closeRelay(relay);
    return { success, failed };
  } catch (e) {
    logger.error(`   ✗ Connection failed: ${e.message}`);
    return { success: 0, failed: events.length };
  }
}

/**
 * Display missing events report
 *
 * @param {Map} missing - Map of relay URL to missing events
 * @returns {Array} Array of relays that need sync
 */
function displayMissingReport(missing) {
  logger.info("\n📋 Missing Events Report:\n");

  let totalMissing = 0;
  const needsSync = [];

  for (const [relayUrl, events] of missing.entries()) {
    if (events.length > 0) {
      totalMissing += events.length;
      needsSync.push({ relayUrl, events });

      // Group by kind
      const byKind = groupEventsByKind(events);

      logger.info(`   ${relayUrl}:`);
      logger.info(`      Missing: ${events.length} events`);

      for (const [kind, kindEvents] of byKind.entries()) {
        const kindName = getKindName(kind);
        logger.info(
          `         - Kind ${kind} (${kindName}): ${kindEvents.length}`
        );
      }
    } else {
      logger.success(`   ${relayUrl}: ✓ Complete`);
    }
  }

  return { totalMissing, needsSync };
}

/**
 * Main sync function
 * Requires NOSTR_SK_HEX in .env to sign and publish events.
 */
async function sync() {
  try {
    // Load private key from environment
    const skHex = process.env.NOSTR_SK_HEX;
    if (!skHex) {
      throw new ConfigError(
        "NOSTR_SK_HEX not found. Set your private key in .env file"
      );
    }

    const pubkey = getPublicKeyFromPrivate(skHex);
    const npub = nip19.npubEncode(pubkey);

    const relayList = process.env.RELAYS || process.env.NOSTR_RELAYS;
    if (!relayList) {
      throw new ConfigError("RELAYS not configured in .env");
    }
    const relays = parseRelayUrls(relayList);

    if (relays.length === 0) {
      throw new ConfigError("No valid relay URLs found");
    }

    // Display header
    logger.header("🔄 Nostr Web Sync Tool");
    logger.info(`🔑 Identity: ${npub}\n`);
    logger.info(`🔌 Configured relays: ${relays.length}`);

    // Build event map
    const { eventMap, relayMap } = await buildEventMap(relays, pubkey);

    if (eventMap.size === 0) {
      logger.error(
        "❌ No events found. Deploy your site first with: nw-publisher deploy\n"
      );
      process.exit(0);
    }

    // Group events by version
    const versions = groupEventsByVersion([...eventMap.values()]);
    logger.info(`📊 Detected versions: ${versions.size}\n`);

    for (const [version, data] of versions.entries()) {
      const totalEvents =
        1 + // site index
        (data.entrypointId ? 1 : 0) +
        data.manifestIds.size +
        data.assetIds.size;
      logger.info(
        `   v${version}: ${totalEvents} events (${data.assetIds.size} assets, ${data.manifestIds.size} manifests)`
      );
    }

    // Find missing events
    const missing = findMissingEvents(eventMap, relayMap, relays);
    const { totalMissing, needsSync } = displayMissingReport(missing);

    if (totalMissing === 0) {
      logger.success("\n✅ All relays are in sync!");
      logger.info("   All versions exist on all configured relays.\n");
      return;
    }

    logger.warn(`\n⚠️  Total missing events: ${totalMissing}`);
    logger.warn(`   ${needsSync.length} relay(s) need synchronization\n`);

    // Confirm sync
    const rl = readline.createInterface({ input, output });
    const answer = await rl.question('Type "SYNC" to publish missing events: ');
    rl.close();

    if (answer.trim() !== "SYNC") {
      logger.info("\n❌ Sync cancelled.\n");
      return;
    }

    // Sync to each relay
    logger.info("\n🔄 Starting synchronization...");

    const stats = {
      totalPublished: 0,
      totalFailed: 0,
      relaysUpdated: 0,
    };

    for (const { relayUrl, events } of needsSync) {
      const result = await syncToRelay(relayUrl, events);
      stats.totalPublished += result.success;
      stats.totalFailed += result.failed;
      if (result.success > 0) {
        stats.relaysUpdated++;
      }
    }

    // Summary
    logger.info("");
    logger.separator();
    logger.info("📊 SYNC SUMMARY");
    logger.separator();
    logger.info("");

    logger.success(`Published: ${stats.totalPublished} events`);
    if (stats.totalFailed > 0) {
      logger.error(`Failed: ${stats.totalFailed} events`);
    }
    logger.info(
      `📡 Relays updated: ${stats.relaysUpdated}/${needsSync.length}`
    );

    logger.info("");
    logger.separator();

    if (stats.totalFailed === 0) {
      logger.success("\n✅ Sync complete! All relays are now consistent.\n");
    } else {
      logger.warn(
        "\n⚠️  Sync completed with some failures. Run again to retry.\n"
      );
    }
  } catch (error) {
    handleError(error);
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  // Show help
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
🔄 Nostr Web Sync Tool

Ensures all versions exist on all configured relays.
Identifies missing events and republishes them.
Requires NOSTR_SK_HEX in .env to sign and publish events.

Usage: nw-publisher sync

Examples:
  # Sync using .env configuration
 nw-publisher sync

What it does:
  1. Queries all events from all configured relays
  2. Identifies which events are missing from which relays
  3. Groups events by version for analysis
  4. Prompts for confirmation
  5. Publishes missing events to incomplete relays

Use cases:
  - Ensure consistency across all relays
  - Add new relays to existing deployments
  - Recover from partial deployment failures
  - Maintain redundancy
`);
    return;
  }

  await sync();

  // Explicitly exit to prevent hanging connections
  process.exit(0);
}

// Run with error handling
main().catch((error) => {
  handleError(error);
  process.exit(1);
});
