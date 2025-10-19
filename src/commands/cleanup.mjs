#!/usr/bin/env node
/**
 * Consolidated Cleanup Command
 *
 * Unified command for cleaning up events from Nostr relays.
 * Supports both full cleanup and orphan-only deletion.
 */

import dotenv from "dotenv";
import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";

// Import refactored utilities
import { EVENT_KINDS, EXIT_CODES } from "../lib/constants.mjs";
import { getPublicKeyFromPrivate } from "../lib/keypair.mjs";
import {
  connectToRelay,
  closeRelay,
  queryEvents,
  parseRelayUrls,
} from "../lib/relay.mjs";
import {
  createDeletionEvent,
  groupEventsByKind,
  getEventId,
} from "../lib/events.mjs";
import { logger } from "../utils/logger.mjs";
import {
  handleError,
  ConfigError,
  NetworkError,
  ValidationError,
} from "../utils/errors.mjs";
import { nip19 } from "nostr-tools";

// Import shared cleanup utilities
import {
  queryAllEventsFromRelay,
  analyzeOrphans,
  deleteEventsFromRelay,
} from "../lib/cleanup-utils.mjs";

dotenv.config();

/**
 * Parse command line arguments
 */
function parseArguments(args) {
  const targetRelays = [];
  let showHelp = false;
  let orphansOnly = false;
  let dryRun = false;
  let allRelays = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      showHelp = true;
    } else if (args[i] === "--relay" || args[i] === "-r") {
      if (i + 1 >= args.length) {
        throw new ValidationError("--relay requires a URL argument");
      }
      targetRelays.push(args[++i]);
      allRelays = false;
    } else if (args[i] === "--orphans" || args[i] === "-o") {
      orphansOnly = true;
    } else if (args[i] === "--dry-run" || args[i] === "-d") {
      dryRun = true;
    } else if (args[i] === "--all" || args[i] === "-a") {
      orphansOnly = false;
    } else if (!args[i].startsWith("-")) {
      throw new ValidationError(
        `Unknown argument: ${args[i]}. Cleanup does not accept site directory. Use options: --all, --orphans, --relay, --dry-run`
      );
    }
  }

  return { targetRelays, showHelp, orphansOnly, dryRun, allRelays };
}

/**
 * Display help message
 */
function showHelpMessage() {
  console.log(`
🧹 Nostr Web Cleanup Tool

Remove events from Nostr relays - clean up everything or just orphaned data.
Requires NOSTR_SK_HEX in .env to sign deletion events.

Usage: nweb cleanup [options]

Options:
  --all, -a                Delete all events (default)
  --orphans, -o            Delete only orphaned events
  --relay <url>, -r <url>  Target specific relay(s) (can be used multiple times)
  --dry-run, -d            Show what would be deleted without deleting
  --help, -h               Show this help message

Examples:
  # Delete all events from all relays
  nweb cleanup

  # Delete only orphaned events
  nweb cleanup --orphans

  # Delete from specific relay
  nweb cleanup --relay wss://relay.example.com

  # Delete orphans from specific relay
  nweb cleanup --orphans --relay wss://relay.example.com
  
  # Preview what would be deleted (dry run)
  nweb cleanup --orphans --dry-run

What it does:
  ALL MODE (--all):
    1. Queries all events (assets, manifests, indexes, entrypoints)
    2. Shows summary of events to be deleted
    3. Asks for confirmation (type "DELETE")
    4. Sends kind 5 deletion events to target relays
    5. Deletes local cache file
    6. Shows deletion statistics per relay

  ORPHANS MODE (--orphans):
    1. Queries all events from target relays
    2. Analyzes event references to find orphans:
       - Assets not referenced by any manifest
       - Manifests not referenced by any site index
       - Site indexes not referenced by any entrypoint
    3. Shows orphan analysis report
    4. Asks for confirmation
    5. Deletes only orphaned events
    6. Keeps local cache (as it contains valid events)

What are orphans?
  - Assets not referenced by any manifest
  - Manifests not referenced by any site index
  - Site indexes not referenced by any entrypoint
  
  Orphans typically occur after:
    - Partial deployment failures
    - Manual event deletion
    - Incomplete rollbacks
    - Testing/debugging

Use cases:
  - Full reset: nweb cleanup
  - Fix corrupted relay: nweb cleanup --orphans --relay wss://relay.com
  - Remove test data: nweb cleanup --relay wss://test-relay.com
  - Clean up before major refactor: nweb cleanup --all
`);
}

/**
 * Confirm deletion with user
 */
async function confirmDeletion(message) {
  const rl = readline.createInterface({ input, output });
  logger.warn(`\n⚠️  ${message}`);
  const answer = await rl.question('Type "DELETE" to confirm: ');
  rl.close();
  return answer.trim() === "DELETE";
}

/**
 * Delete all events from relays (full cleanup)
 */
async function performFullCleanup(pubkey, relays, skHex, dryRun) {
  logger.info("\n🔍 Querying events from all relays...\n");

  const allEvents = [];
  const relayEvents = new Map();

  // Query all relays
  for (const relayUrl of relays) {
    const events = await queryAllEventsFromRelay(relayUrl, pubkey);
    relayEvents.set(relayUrl, events);
    allEvents.push(...events);
  }

  // Remove duplicates
  const uniqueEvents = Array.from(
    new Map(allEvents.map((e) => [getEventId(e), e])).values()
  );

  // Group by kind
  const byKind = groupEventsByKind(uniqueEvents);

  // Display summary
  logger.info("\n📊 Events to be deleted:\n");
  logger.info(`   Assets: ${byKind[EVENT_KINDS.ASSET]?.length || 0}`);
  logger.info(`   Manifests: ${byKind[EVENT_KINDS.MANIFEST]?.length || 0}`);
  logger.info(
    `   Site Indexes: ${byKind[EVENT_KINDS.SITE_INDEX]?.length || 0}`
  );
  logger.info(`   Entrypoints: ${byKind[EVENT_KINDS.ENTRYPOINT]?.length || 0}`);
  logger.info(`   Total: ${uniqueEvents.length}`);

  logger.info("\n📡 Relay breakdown:\n");
  for (const [relay, events] of relayEvents) {
    logger.info(`   ${relay}: ${events.length} events`);
  }

  if (uniqueEvents.length === 0) {
    logger.success("\n✓ No events found. Nothing to delete.");
    return;
  }

  if (dryRun) {
    logger.info("\n🔍 DRY RUN - No events will be deleted");
    return;
  }

  // Confirm deletion
  const confirmed = await confirmDeletion(
    `This will delete ALL ${uniqueEvents.length} events from ${relays.length} relay(s).`
  );

  if (!confirmed) {
    logger.info("\n❌ Cleanup canceled.");
    process.exit(0);
  }

  // Perform deletion
  logger.info("\n🗑️  Deleting events...\n");

  const eventIds = uniqueEvents.map(getEventId);
  const results = {};

  for (const relayUrl of relays) {
    process.stdout.write(`   ${relayUrl}: `);
    const result = await deleteEventsFromRelay(relayUrl, eventIds, skHex);
    console.log(` ✓ ${result.published} deleted, ${result.failed} failed`);
    results[relayUrl] = result;
  }

  // Display summary
  logger.info("\n📊 Deletion Summary:\n");
  let totalPublished = 0;
  let totalFailed = 0;

  for (const [relay, result] of Object.entries(results)) {
    logger.info(`   ${relay}:`);
    logger.success(`      ✓ Deleted: ${result.published}`);
    if (result.failed > 0) {
      logger.error(`      ✗ Failed: ${result.failed}`);
    }
    totalPublished += result.published;
    totalFailed += result.failed;
  }

  logger.info(`\n   Total deleted: ${totalPublished}`);
  if (totalFailed > 0) {
    logger.warn(`   Total failed: ${totalFailed}`);
  }

  logger.success("\n✅ Cleanup complete!");
}

/**
 * Delete only orphaned events (targeted cleanup)
 */
async function performOrphanCleanup(pubkey, relays, skHex, dryRun) {
  logger.info("\n🔍 Analyzing orphaned events...\n");

  const relayAnalysis = [];

  // Analyze each relay
  for (const relayUrl of relays) {
    logger.info(`   Querying ${relayUrl}...`);
    const events = await queryAllEventsFromRelay(relayUrl, pubkey);
    const orphans = analyzeOrphans(events);

    relayAnalysis.push({
      url: relayUrl,
      events,
      orphans,
    });
  }

  // Display orphan report
  logger.info("\n📋 Orphan Analysis Report:\n");

  let totalOrphans = 0;
  const orphanEventIds = new Map(); // relay -> event IDs

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
  }

  if (totalOrphans === 0) {
    logger.success("\n✓ No orphans found. All events are properly referenced!");
    return;
  }

  if (dryRun) {
    logger.info(`\n🔍 DRY RUN - Would delete ${totalOrphans} orphaned events`);
    return;
  }

  // Confirm deletion
  const confirmed = await confirmDeletion(
    `This will delete ${totalOrphans} orphaned events from ${relays.length} relay(s).`
  );

  if (!confirmed) {
    logger.info("\n❌ Cleanup canceled.");
    process.exit(0);
  }

  // Perform deletion
  logger.info("\n🗑️  Deleting orphaned events...\n");

  const results = {};
  for (const [relayUrl, eventIds] of orphanEventIds) {
    if (eventIds.length === 0) continue;

    process.stdout.write(`   ${relayUrl}: `);
    const result = await deleteEventsFromRelay(relayUrl, eventIds, skHex);
    console.log(` ✓ ${result.published} deleted, ${result.failed} failed`);
    results[relayUrl] = result;
  }

  // Display summary
  logger.info("\n📊 Deletion Summary:\n");
  let totalPublished = 0;
  let totalFailed = 0;

  for (const [relay, result] of Object.entries(results)) {
    logger.info(`   ${relay}:`);
    logger.success(`      ✓ Deleted: ${result.published}`);
    if (result.failed > 0) {
      logger.error(`      ✗ Failed: ${result.failed}`);
    }
    totalPublished += result.published;
    totalFailed += result.failed;
  }

  logger.info(`\n   Total deleted: ${totalPublished}`);
  if (totalFailed > 0) {
    logger.warn(`   Total failed: ${totalFailed}`);
  }

  logger.success("\n✅ Orphan cleanup complete!");
  logger.info("   Note: Local cache was not deleted (contains valid events)");
}

/**
 * Main function
 */
async function main() {
  try {
    const args = process.argv.slice(2);
    const { targetRelays, showHelp, orphansOnly, dryRun, allRelays } =
      parseArguments(args);

    if (showHelp) {
      showHelpMessage();
      return;
    }

    // Get private key from environment
    const skHex = process.env.NOSTR_SK_HEX;
    if (!skHex) {
      throw new ConfigError(
        "NOSTR_SK_HEX not found. Set your private key in .env file"
      );
    }

    const pubkey = getPublicKeyFromPrivate(skHex);
    const npub = nip19.npubEncode(pubkey);

    logger.info(
      "======================================================================"
    );
    logger.info("🧹 Nostr Web Cleanup");
    logger.info(
      "======================================================================\n"
    );
    logger.info(`🔑 Identity: ${npub}`);

    // Determine target relays
    let relays;
    if (targetRelays.length > 0) {
      relays = targetRelays;
      logger.info(`📡 Target: ${relays.length} specific relay(s)`);
    } else {
      // Use relays from environment
      const envRelays = process.env.RELAYS || process.env.NOSTR_RELAYS;
      if (!envRelays) {
        throw new ConfigError(
          "No relays configured. Set RELAYS in .env or use --relay option."
        );
      }
      relays = parseRelayUrls(envRelays);
      logger.info(`📡 Target: ${relays.length} configured relay(s)`);
    }

    for (const relay of relays) {
      logger.info(`   - ${relay}`);
    }

    // Perform cleanup
    if (orphansOnly) {
      logger.info(
        `\n🎯 Mode: Orphan cleanup (delete unreferenced events only)`
      );
      await performOrphanCleanup(pubkey, relays, skHex, dryRun);
    } else {
      logger.info(`\n🎯 Mode: Full cleanup (delete all events)`);
      await performFullCleanup(pubkey, relays, skHex, dryRun);

      if (!dryRun) {
        logger.info(
          `\n💡 Note: Local cache files (.nweb-cache.json) are not automatically deleted.`
        );
        logger.info(
          `   Delete them manually from your site directories if needed.`
        );
      }
    }

    logger.info(
      "\n======================================================================"
    );

    // Explicitly exit to prevent hanging connections
    process.exit(0);
  } catch (error) {
    handleError(error);
    process.exit(1);
  }
}

// Run
main();
