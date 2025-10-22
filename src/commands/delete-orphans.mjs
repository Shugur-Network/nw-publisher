#!/usr/bin/env node
/**
 * Delete Orphans Command - Refactored Version
 *
 * Deletes orphaned/incomplete events from specific relays.
 * Useful for cleaning up relays with partial or corrupted data.
 */

import dotenv from "dotenv";
import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";

// Import refactored utilities
import { EVENT_KINDS } from "../lib/constants.mjs";
import { getPrivateKey, getPublicKeyFromPrivate } from "../lib/keypair.mjs";
import { connectToRelay, closeRelay, queryEvents } from "../lib/relay.mjs";
import { createDeletionEvent, getEventId } from "../lib/events.mjs";
import { logger } from "../utils/logger.mjs";
import { handleError, ValidationError } from "../utils/errors.mjs";
import { nip19 } from "nostr-tools";

// Load .env from current working directory
dotenv.config({ path: process.cwd() + '/.env' });

/**
 * Query all events from a relay
 *
 * @param {string} relayUrl - Relay URL
 * @param {string} pubkey - Author public key
 * @returns {Promise<Array>} Array of events
 */
async function queryAllEvents(relayUrl, pubkey) {
  try {
    logger.info(`   Connecting to ${relayUrl}...`);
    const relay = await connectToRelay(relayUrl);

    const kinds = [
      EVENT_KINDS.ASSET,
      EVENT_KINDS.MANIFEST,
      EVENT_KINDS.SITE_INDEX,
      EVENT_KINDS.ENTRYPOINT,
    ];

    const events = await queryEvents(relay, [{ kinds, authors: [pubkey] }]);
    logger.info(`   Found ${events.length} events`);

    closeRelay(relay);
    return events;
  } catch (error) {
    logger.error(`   ✗ Error querying relay: ${error.message}`);
    return [];
  }
}

/**
 * Analyze events to find orphans
 *
 * @param {Array} events - All events
 * @returns {Object} Orphan analysis
 */
function analyzeOrphans(events) {
  const byKind = {
    [EVENT_KINDS.ASSET]: [],
    [EVENT_KINDS.MANIFEST]: [],
    [EVENT_KINDS.SITE_INDEX]: [],
    [EVENT_KINDS.ENTRYPOINT]: [],
  };

  // Group by kind
  for (const event of events) {
    if (byKind[event.kind]) {
      byKind[event.kind].push(event);
    }
  }

  // Find referenced event IDs
  const referencedAssets = new Set();
  const referencedManifests = new Set();
  const referencedIndexes = new Set();

  // Entrypoints reference site indexes
  for (const entrypoint of byKind[EVENT_KINDS.ENTRYPOINT]) {
    const aTag = entrypoint.tags.find((t) => t[0] === "a");
    if (aTag) {
      const [kind, pubkey, dTag] = aTag[1].split(":");
      const index = byKind[EVENT_KINDS.SITE_INDEX].find(
        (e) =>
          e.pubkey === pubkey &&
          e.tags.find((t) => t[0] === "d" && t[1] === dTag)
      );
      if (index) {
        referencedIndexes.add(getEventId(index));
      }
    }
  }

  // Site indexes reference manifests (via JSON content)
  for (const index of byKind[EVENT_KINDS.SITE_INDEX]) {
    if (
      referencedIndexes.has(getEventId(index)) ||
      referencedIndexes.size === 0
    ) {
      try {
        const content = JSON.parse(index.content);
        const routes = content.routes || {};
        for (const manifestId of Object.values(routes)) {
          if (manifestId) {
            referencedManifests.add(manifestId);
          }
        }
      } catch (error) {
        logger.debug(`Failed to parse site index content: ${error.message}`);
      }
    }
  }

  // Manifests reference assets
  for (const manifest of byKind[EVENT_KINDS.MANIFEST]) {
    if (
      referencedManifests.has(getEventId(manifest)) ||
      referencedManifests.size === 0
    ) {
      for (const tag of manifest.tags) {
        if (tag[0] === "e") {
          referencedAssets.add(tag[1]);
        }
      }
    }
  }

  // Find orphans
  const orphans = {
    assets: [],
    manifests: [],
    indexes: [],
  };

  // Orphaned assets (not referenced by any manifest)
  for (const asset of byKind[EVENT_KINDS.ASSET]) {
    if (!referencedAssets.has(getEventId(asset))) {
      orphans.assets.push(asset);
    }
  }

  // Orphaned manifests (not referenced by any index)
  for (const manifest of byKind[EVENT_KINDS.MANIFEST]) {
    if (!referencedManifests.has(getEventId(manifest))) {
      orphans.manifests.push(manifest);
    }
  }

  // Orphaned indexes (not referenced by any entrypoint)
  for (const index of byKind[EVENT_KINDS.SITE_INDEX]) {
    if (!referencedIndexes.has(getEventId(index))) {
      orphans.indexes.push(index);
    }
  }

  return {
    orphans,
    total: byKind,
  };
}

/**
 * Delete events from a relay
 *
 * @param {string} relayUrl - Relay URL
 * @param {Array<string>} eventIds - Event IDs to delete
 * @param {string} skHex - Private key
 * @returns {Promise<Object>} Deletion results
 */
async function deleteEventsFromRelay(relayUrl, eventIds, skHex) {
  try {
    logger.info(`   Connecting to ${relayUrl}...`);
    const relay = await connectRelay(relayUrl);

    let published = 0;
    let failed = 0;

    for (const eventId of eventIds) {
      const deleteEvent = createDeletionEvent(
        [eventId],
        "Orphan cleanup",
        skHex
      );

      try {
        await relay.publish(deleteEvent);
        published++;
        process.stdout.write(".");
      } catch (error) {
        failed++;
        process.stdout.write("✗");
        logger.debug(`Failed to delete ${eventId}: ${error.message}`);
      }
    }

    console.log("");
    closeRelay(relay);

    return { published, failed };
  } catch (error) {
    logger.error(`Connection failed: ${error.message}`);
    return { published: 0, failed: eventIds.length };
  }
}

/**
 * Parse command line arguments
 *
 * @param {Array<string>} args - Command line arguments
 * @returns {Object} Parsed arguments
 */
function parseArguments(args) {
  let siteDir = null;
  const targetRelays = [];
  let showHelp = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      showHelp = true;
    } else if (args[i] === "--relay" || args[i] === "-r") {
      if (i + 1 >= args.length) {
        throw new ValidationError("--relay requires a URL argument");
      }
      targetRelays.push(args[++i]);
    } else if (!siteDir) {
      siteDir = args[i];
    }
  }

  return { siteDir, targetRelays, showHelp };
}

/**
 * Display orphan analysis report
 *
 * @param {Array} relayAnalysis - Analysis results per relay
 * @returns {Object} Summary data
 */
function displayOrphanReport(relayAnalysis) {
  logger.info("\n📋 Orphan Analysis Report:\n");

  let totalOrphans = 0;
  const orphanEventIds = new Map();

  for (const relay of relayAnalysis) {
    const orphanCount =
      relay.orphans.assets.length +
      relay.orphans.manifests.length +
      relay.orphans.indexes.length;

    totalOrphans += orphanCount;

    logger.info(`${relay.url}:`);
    logger.info(`   Total events: ${relay.events.length}`);

    if (orphanCount === 0) {
      logger.success(`   ✓ No orphans found`);
    } else {
      logger.warn(`   ⚠️  Orphans found: ${orphanCount}`);
      if (relay.orphans.assets.length > 0) {
        logger.info(`      - Assets: ${relay.orphans.assets.length}`);
      }
      if (relay.orphans.manifests.length > 0) {
        logger.info(`      - Manifests: ${relay.orphans.manifests.length}`);
      }
      if (relay.orphans.indexes.length > 0) {
        logger.info(`      - Site Indexes: ${relay.orphans.indexes.length}`);
      }

      // Collect event IDs to delete
      const eventIds = [
        ...relay.orphans.assets.map(getEventId),
        ...relay.orphans.manifests.map(getEventId),
        ...relay.orphans.indexes.map(getEventId),
      ];
      orphanEventIds.set(relay.url, eventIds);
    }
    logger.info("");
  }

  return { totalOrphans, orphanEventIds };
}

/**
 * Main delete orphans function
 *
 * @param {string} siteDir - Site directory (optional)
 * @param {Array<string>} targetRelays - Target relay URLs
 */
async function deleteOrphans(siteDir, targetRelays) {
  try {
    // Validate inputs
    if (targetRelays.length === 0) {
      throw new ValidationError(
        "No relays specified. Use --relay <url> to specify target relay(s)"
      );
    }

    // Get credentials
    const skHex = getPrivateKey(siteDir);
    const pubkey = getPublicKeyFromPrivate(skHex);
    const npub = nip19.npubEncode(pubkey);

    // Display header
    logger.header("🧹 Nostr Web Orphan Deletion Tool");
    logger.info(`🔑 Identity: ${npub}\n`);
    logger.info(`🎯 Target relays: ${targetRelays.length}`);
    targetRelays.forEach((r) => logger.info(`   - ${r}`));
    logger.info("");

    // Query and analyze each relay
    logger.info("🔍 Analyzing relays for orphaned events...\n");

    const relayAnalysis = [];

    for (const relayUrl of targetRelays) {
      const events = await queryAllEvents(relayUrl, pubkey);
      const analysis = analyzeOrphans(events);

      relayAnalysis.push({
        url: relayUrl,
        events,
        ...analysis,
      });
    }

    // Display report
    const { totalOrphans, orphanEventIds } = displayOrphanReport(relayAnalysis);

    if (totalOrphans === 0) {
      logger.success("✅ No orphans found on any relay!\n");
      logger.info("   All events are properly referenced.\n");
      return;
    }

    // Confirmation prompt
    logger.separator();
    logger.warn(`⚠️  Total orphans found: ${totalOrphans}`);
    logger.warn(`   ${orphanEventIds.size} relay(s) need cleanup\n`);

    const rl = readline.createInterface({ input, output });
    const confirmation = await rl.question('Type "DELETE" to remove orphans: ');
    rl.close();

    if (confirmation !== "DELETE") {
      logger.info("\n❌ Deletion cancelled.\n");
      return;
    }

    // Delete orphans
    logger.info("\n🗑️  Deleting orphans...\n");

    const deletionResults = [];

    for (const [relayUrl, eventIds] of orphanEventIds) {
      logger.info(`Relay: ${relayUrl}`);
      const result = await deleteEventsFromRelay(relayUrl, eventIds, skHex);
      deletionResults.push({ url: relayUrl, ...result });
      logger.info(`   ✓ Deleted: ${result.published}/${eventIds.length}\n`);
    }

    // Summary
    logger.separator();
    logger.info("📊 DELETION SUMMARY");
    logger.separator();
    logger.info("");

    const totalDeleted = deletionResults.reduce(
      (sum, r) => sum + r.published,
      0
    );
    const totalFailed = deletionResults.reduce((sum, r) => sum + r.failed, 0);

    logger.success(`Deleted: ${totalDeleted} events`);
    if (totalFailed > 0) {
      logger.error(`Failed: ${totalFailed} events`);
    }
    logger.info(`📡 Relays cleaned: ${deletionResults.length}`);
    logger.info("");
    logger.separator();
    logger.info("");

    if (totalFailed === 0) {
      logger.success("✅ Orphan cleanup complete!\n");
    } else {
      logger.warn("⚠️  Cleanup completed with some failures.\n");
      logger.info("   Run again to retry failed deletions.\n");
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

  // Parse arguments
  const { siteDir, targetRelays, showHelp } = parseArguments(args);

  // Show help
  if (showHelp) {
    console.log(`
🧹 Nostr Web Orphan Deletion Tool

Deletes orphaned/incomplete events from specific relays.

Usage: nw-publisher delete-orphans [site-folder] [options]

Options:
  --relay <url>, -r <url>  Target specific relay (can be used multiple times)
  --help, -h               Show this help message

Examples:
  # Delete orphans from specific relay
  nw-publisher delete-orphans --relay wss://relay.example.com
  
  # Delete orphans from multiple relays
  nw-publisher delete-orphans -r wss://relay1.com -r wss://relay2.com
  
  # With site directory
  nw-publisher delete-orphans ./my-site --relay wss://relay.example.com

What are orphans?
  - Assets not referenced by any manifest
  - Manifests not referenced by any site index
  - Site indexes not referenced by any entrypoint
  
These typically occur after:
  - Partial deployment failures
  - Manual event deletion
  - Incomplete rollbacks
  - Testing/debugging

Use cases:
  - Clean up after partial deployment failures
  - Remove test data from specific relays
  - Fix relays with corrupted state
  - Prepare relay for fresh sync
`);
    return;
  }

  await deleteOrphans(siteDir, targetRelays);
}

// Run with error handling
main().catch((error) => {
  handleError(error);
});
