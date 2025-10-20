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
  let targetVersion = null;

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
    } else if (args[i] === "--version" || args[i] === "-v") {
      if (i + 1 >= args.length) {
        throw new ValidationError("--version requires a version argument");
      }
      targetVersion = args[++i];
    } else if (!args[i].startsWith("-")) {
      throw new ValidationError(
        `Unknown argument: ${args[i]}. Cleanup does not accept site directory. Use options: --all, --orphans, --version, --relay, --dry-run`
      );
    }
  }

  return {
    targetRelays,
    showHelp,
    orphansOnly,
    dryRun,
    allRelays,
    targetVersion,
  };
}

/**
 * Display help message
 */
function showHelpMessage() {
  console.log(`
🧹 Nostr Web Cleanup Tool

Remove events from Nostr relays - clean up everything, orphaned data, or a specific version.
Requires NOSTR_SK_HEX in .env to sign deletion events.

Usage: nweb cleanup [options]

Options:
  --all, -a                Delete all events (default)
  --orphans, -o            Delete only orphaned events
  --version <ver>, -v      Delete a specific version and its assets
  --relay <url>, -r <url>  Target specific relay(s) (can be used multiple times)
  --dry-run, -d            Show what would be deleted without deleting
  --help, -h               Show this help message

Examples:
  # Delete all events from all relays
  nweb cleanup

  # Delete only orphaned events
  nweb cleanup --orphans

  # Delete a specific version
  nweb cleanup --version 0.1.0

  # Delete from specific relay
  nweb cleanup --relay wss://relay.example.com

  # Delete orphans from specific relay
  nweb cleanup --orphans --relay wss://relay.example.com
  
  # Preview what would be deleted (dry run)
  nweb cleanup --version 0.2.0 --dry-run

What it does:
  ALL MODE (--all):
    1. Queries all events (assets, manifests, indexes, entrypoints)
    2. Shows summary of events to be deleted
    3. Asks for confirmation (type "DELETE")
    4. Sends kind 5 deletion events to target relays
    5. Shows deletion statistics per relay

  ORPHANS MODE (--orphans):
    1. Queries all events from target relays
    2. Analyzes event references to find orphans:
       - Assets not referenced by any manifest
       - Manifests not referenced by any site index
       - Site indexes not referenced by any entrypoint
    3. Shows orphan analysis report
    4. Asks for confirmation
    5. Deletes only orphaned events

  VERSION MODE (--version):
    1. Queries all site index events to find the target version
    2. Identifies the site index and entrypoint for that version
    3. Finds all manifests and assets referenced by that version
    4. Shows summary of events to be deleted
    5. Asks for confirmation
    6. Deletes only events specific to that version

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
  - Remove old version: nweb cleanup --version 0.1.0
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
  logger.info(`   Assets: ${byKind.get(EVENT_KINDS.ASSET)?.length || 0}`);
  logger.info(`   Manifests: ${byKind.get(EVENT_KINDS.MANIFEST)?.length || 0}`);
  logger.info(
    `   Site Indexes: ${byKind.get(EVENT_KINDS.SITE_INDEX)?.length || 0}`
  );
  logger.info(
    `   Entrypoints: ${byKind.get(EVENT_KINDS.ENTRYPOINT)?.length || 0}`
  );
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
 * Query all site index events from relay
 */
async function queryAllSiteIndexes(relay, pubkey) {
  try {
    const events = await queryEvents(relay, [
      {
        kinds: [EVENT_KINDS.SITE_INDEX],
        authors: [pubkey],
      },
    ]);
    return events;
  } catch (error) {
    logger.debug(`Query site indexes failed: ${error.message}`);
    return [];
  }
}

/**
 * Query entrypoint events from relay
 */
async function queryEntrypoints(relay, pubkey) {
  try {
    const events = await queryEvents(relay, [
      {
        kinds: [EVENT_KINDS.ENTRYPOINT],
        authors: [pubkey],
      },
    ]);
    return events;
  } catch (error) {
    logger.debug(`Query entrypoints failed: ${error.message}`);
    return [];
  }
}

/**
 * Query manifest events from relay
 */
async function queryManifests(relay, pubkey) {
  try {
    const events = await queryEvents(relay, [
      {
        kinds: [EVENT_KINDS.MANIFEST],
        authors: [pubkey],
      },
    ]);
    return events;
  } catch (error) {
    logger.debug(`Query manifests failed: ${error.message}`);
    return [];
  }
}

/**
 * Query asset events from relay
 */
async function queryAssets(relay, pubkey, assetIds) {
  try {
    const events = await queryEvents(relay, [
      {
        kinds: [EVENT_KINDS.ASSET],
        authors: [pubkey],
        ids: assetIds,
      },
    ]);
    return events;
  } catch (error) {
    logger.debug(`Query assets failed: ${error.message}`);
    return [];
  }
}

/**
 * Delete a specific version and its assets
 */
async function performVersionCleanup(pubkey, relays, skHex, version, dryRun) {
  logger.info(`\n🔍 Locating version ${version}...\n`);

  // Query all site indexes and entrypoints from all relays
  let allSiteIndexes = [];
  let allEntrypoints = [];

  for (const relayUrl of relays) {
    logger.info(`   Querying ${relayUrl}...`);
    const relay = await connectToRelay(relayUrl);
    const siteIndexes = await queryAllSiteIndexes(relay, pubkey);
    const entrypoints = await queryEntrypoints(relay, pubkey);

    // Deduplicate by event ID
    for (const event of siteIndexes) {
      if (!allSiteIndexes.find((e) => getEventId(e) === getEventId(event))) {
        allSiteIndexes.push(event);
      }
    }
    for (const event of entrypoints) {
      if (!allEntrypoints.find((e) => getEventId(e) === getEventId(event))) {
        allEntrypoints.push(event);
      }
    }

    closeRelay(relay);
  }

  // Find the target version's site index
  let targetSiteIndex = null;
  for (const siteIndex of allSiteIndexes) {
    try {
      const content = JSON.parse(siteIndex.content);
      if (content.version === version) {
        targetSiteIndex = siteIndex;
        break;
      }
    } catch (error) {
      logger.debug(`Failed to parse site index: ${error.message}`);
    }
  }

  if (!targetSiteIndex) {
    throw new ValidationError(
      `Version ${version} not found. Use 'nweb versions list' to see available versions.`
    );
  }

  const siteIndexId = getEventId(targetSiteIndex);
  const dTag = targetSiteIndex.tags.find((t) => t[0] === "d")?.[1];

  logger.success(`   ✓ Found version ${version}`);
  logger.info(`     Site Index ID: ${siteIndexId.substring(0, 16)}...`);

  // Find entrypoint for this version
  const entrypoint = allEntrypoints.find((ep) => {
    const aTag = ep.tags.find((t) => t[0] === "a")?.[1];
    return aTag && aTag.includes(`:${dTag}`);
  });

  const eventsToDelete = [targetSiteIndex];
  if (entrypoint) {
    eventsToDelete.push(entrypoint);
    logger.info(
      `     Entrypoint ID: ${getEventId(entrypoint).substring(0, 16)}...`
    );
  }

  // Parse site index to get manifest IDs
  const content = JSON.parse(targetSiteIndex.content);
  const manifestIds = Object.values(content.routes || {});

  logger.info(`\n   Fetching ${manifestIds.length} manifest(s)...`);

  // Query manifests from all relays
  const manifestEvents = [];
  for (const relayUrl of relays) {
    const relay = await connectToRelay(relayUrl);
    const manifests = await queryManifests(relay, pubkey);

    // Filter to only the ones referenced by this version
    for (const manifest of manifests) {
      const manifestId = getEventId(manifest);
      if (manifestIds.includes(manifestId)) {
        if (!manifestEvents.find((e) => getEventId(e) === manifestId)) {
          manifestEvents.push(manifest);
        }
      }
    }

    closeRelay(relay);
  }

  eventsToDelete.push(...manifestEvents);
  logger.info(`     Found ${manifestEvents.length} manifest(s)`);

  // Parse manifests to get asset IDs
  const assetIds = new Set();
  for (const manifest of manifestEvents) {
    try {
      const manifestContent = JSON.parse(manifest.content);
      const assets = manifestContent.assets || [];
      for (const asset of assets) {
        if (asset.id) {
          assetIds.add(asset.id);
        }
      }
    } catch (error) {
      logger.debug(`Failed to parse manifest: ${error.message}`);
    }
  }

  logger.info(`\n   Fetching ${assetIds.size} asset(s)...`);

  // Query assets from all relays
  const assetEvents = [];
  const assetIdArray = Array.from(assetIds);

  for (const relayUrl of relays) {
    const relay = await connectToRelay(relayUrl);
    const assets = await queryAssets(relay, pubkey, assetIdArray);

    for (const asset of assets) {
      const assetId = getEventId(asset);
      if (!assetEvents.find((e) => getEventId(e) === assetId)) {
        assetEvents.push(asset);
      }
    }

    closeRelay(relay);
  }

  eventsToDelete.push(...assetEvents);
  logger.info(`     Found ${assetEvents.length} asset(s)`);

  // Display summary
  logger.info("\n📊 Events to be deleted:\n");
  logger.info(`   Version: ${version}`);
  logger.info(`   Site Index: 1`);
  logger.info(`   Entrypoint: ${entrypoint ? 1 : 0}`);
  logger.info(`   Manifests: ${manifestEvents.length}`);
  logger.info(`   Assets: ${assetEvents.length}`);
  logger.info(`   Total: ${eventsToDelete.length}`);

  if (dryRun) {
    logger.info("\n🔍 DRY RUN - No events will be deleted");
    return;
  }

  // Confirm deletion
  const confirmed = await confirmDeletion(
    `This will delete version ${version} (${eventsToDelete.length} events) from ${relays.length} relay(s).`
  );

  if (!confirmed) {
    logger.info("\n❌ Cleanup canceled.");
    process.exit(0);
  }

  // Perform deletion
  logger.info("\n🗑️  Deleting version events...\n");

  const eventIds = eventsToDelete.map(getEventId);
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

  logger.success(`\n✅ Version ${version} deleted successfully!`);
}

/**
 * Main function
 */
async function main() {
  try {
    const args = process.argv.slice(2);
    const {
      targetRelays,
      showHelp,
      orphansOnly,
      dryRun,
      allRelays,
      targetVersion,
    } = parseArguments(args);

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

    // Perform cleanup based on mode
    if (targetVersion) {
      logger.info(`\n🎯 Mode: Version cleanup (delete specific version)`);
      await performVersionCleanup(pubkey, relays, skHex, targetVersion, dryRun);
    } else if (orphansOnly) {
      logger.info(
        `\n🎯 Mode: Orphan cleanup (delete unreferenced events only)`
      );
      await performOrphanCleanup(pubkey, relays, skHex, dryRun);
    } else {
      logger.info(`\n🎯 Mode: Full cleanup (delete all events)`);
      await performFullCleanup(pubkey, relays, skHex, dryRun);
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
