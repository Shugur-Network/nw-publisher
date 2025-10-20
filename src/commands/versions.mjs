#!/usr/bin/env node
/**
 * Versions Command - Refactored Version
 *
 * Manage site versions - list, show, compare, and track version history.
 */

import dotenv from "dotenv";
import { nip19 } from "nostr-tools";

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
import { handleError, ConfigError, ValidationError } from "../utils/errors.mjs";

dotenv.config();

/**
 * Get pubkey from CLI argument or environment
 * Read-only command - only accepts npub/hex, not site directory
 */
function getPubkey(pubkeyArg) {
  // 1. Try from CLI argument (npub or hex)
  if (pubkeyArg) {
    if (pubkeyArg.startsWith("npub1")) {
      try {
        const { data } = nip19.decode(pubkeyArg);
        return { pubkey: data, npub: pubkeyArg };
      } catch (error) {
        throw new ValidationError(`Invalid npub: ${error.message}`);
      }
    }

    // Try as hex (64 char hex string)
    if (/^[0-9a-f]{64}$/i.test(pubkeyArg)) {
      const npub = nip19.npubEncode(pubkeyArg);
      return { pubkey: pubkeyArg, npub };
    }

    throw new ValidationError(
      "Invalid pubkey format. Use npub1... or 64-char hex"
    );
  }

  // 2. Try from environment (NOSTR_SK_HEX from .env or system env)
  if (process.env.NOSTR_SK_HEX) {
    try {
      const pubkey = getPublicKeyFromPrivate(process.env.NOSTR_SK_HEX);
      const npub = nip19.npubEncode(pubkey);
      return { pubkey, npub };
    } catch (error) {
      throw new ConfigError(
        `Failed to derive pubkey from NOSTR_SK_HEX: ${error.message}`
      );
    }
  }

  throw new ConfigError(
    "No pubkey found. Provide npub/hex as argument or set NOSTR_SK_HEX in .env"
  );
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
 * Build version history from relay events
 */
function buildVersionHistory(siteIndexEvents, entrypointEvents) {
  // Sort site indexes by creation time (oldest first)
  const sortedIndexes = [...siteIndexEvents].sort(
    (a, b) => a.created_at - b.created_at
  );

  const versions = sortedIndexes
    .map((event, index) => {
      try {
        const content = JSON.parse(event.content);
        const dTag = event.tags.find((t) => t[0] === "d")?.[1];
        const xTag = event.tags.find((t) => t[0] === "x")?.[1];

        // Find corresponding entrypoint
        const entrypoint = entrypointEvents.find((ep) => {
          const aTag = ep.tags.find((t) => t[0] === "a")?.[1];
          return aTag && aTag.includes(`:${dTag}`);
        });

        return {
          version: content.version || `${index + 1}.0.0`,
          siteIndexId: getEventId(event),
          entrypointId: entrypoint ? getEventId(entrypoint) : null,
          contentHash: dTag,
          fullHash: xTag,
          timestamp: new Date(event.created_at * 1000).toISOString(),
          created_at: event.created_at,
          routes: Object.keys(content.routes || {}),
          defaultRoute: content.defaultRoute,
          notFoundRoute: content.notFoundRoute,
          routeManifests: content.routes || {},
        };
      } catch (error) {
        logger.debug(`Failed to parse site index event: ${error.message}`);
        return null;
      }
    })
    .filter(Boolean);

  const current =
    versions.length > 0 ? versions[versions.length - 1].version : "0.0.0";

  return {
    current,
    versions,
    totalVersions: versions.length,
  };
}

/**
 * Fetch version history from relays
 */
async function fetchVersionHistory(pubkey, npub) {
  const relayList = process.env.RELAYS || process.env.NOSTR_RELAYS;
  if (!relayList) {
    throw new ConfigError("RELAYS not configured in .env");
  }
  const relays = parseRelayUrls(relayList);

  logger.info("\n🔍 Fetching version history from relays...");
  logger.info(`   Site: ${npub}\n`);

  let allSiteIndexes = [];
  let allEntrypoints = [];

  for (const relayUrl of relays) {
    try {
      logger.info(`   Connecting to ${relayUrl}...`);
      const relay = await connectToRelay(relayUrl);

      const siteIndexes = await queryAllSiteIndexes(relay, pubkey);
      const entrypoints = await queryEntrypoints(relay, pubkey);

      logger.info(
        `      Found ${siteIndexes.length} site index(es), ${entrypoints.length} entrypoint(s)`
      );

      // Merge events (deduplicate by ID)
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
    } catch (error) {
      logger.warn(`      ✗ ${error.message}`);
    }
  }

  logger.info(
    `\n   Total unique: ${allSiteIndexes.length} site index(es), ${allEntrypoints.length} entrypoint(s)\n`
  );

  if (allSiteIndexes.length === 0) {
    throw new ValidationError(
      "No site indexes found on any relay. Has this site been published yet?"
    );
  }

  return buildVersionHistory(allSiteIndexes, allEntrypoints);
}

/**
 * List all versions
 */
async function listVersions(pubkey, npub) {
  const history = await fetchVersionHistory(pubkey, npub);

  logger.header("📚 Version History");
  logger.info(`Current Version: ${history.current}\n`);

  if (history.versions.length === 0) {
    logger.info("No versions available.\n");
    return;
  }

  logger.info(`Total Versions: ${history.versions.length}\n`);

  // Display versions in reverse chronological order (newest first)
  const versions = [...history.versions].reverse();

  for (let i = 0; i < versions.length; i++) {
    const v = versions[i];
    const isCurrent = i === 0;
    const marker = isCurrent ? "→ " : "  ";

    if (isCurrent) {
      logger.success(`${marker}v${v.version} (current)`);
    } else {
      logger.info(`${marker}v${v.version}`);
    }
    logger.info(`  Date: ${new Date(v.timestamp).toLocaleString()}`);
    logger.info(`  Hash: ${v.contentHash}`);
    logger.info(`  Site Index: ${v.siteIndexId.substring(0, 16)}...`);
    if (v.entrypointId) {
      logger.info(`  Entrypoint: ${v.entrypointId.substring(0, 16)}...`);
    }
    logger.info(`  Routes (${v.routes.length}): ${v.routes.join(", ")}`);

    if (i < versions.length - 1) {
      logger.info("");
    }
  }

  logger.info("");
  logger.separator();
  logger.info("");
}

/**
 * Show version details
 */
async function showVersion(pubkey, npub, version) {
  const history = await fetchVersionHistory(pubkey, npub);

  const versionEntry = history.versions.find((v) => v.version === version);

  if (!versionEntry) {
    logger.error(`❌ Version ${version} not found`);
    logger.info("\nAvailable versions:");
    history.versions.forEach((v) => logger.info(`  - ${v.version}`));
    process.exit(1);
  }

  logger.header("📖 Version Details");
  logger.info(`Version: ${versionEntry.version}`);
  logger.info(`Date: ${new Date(versionEntry.timestamp).toLocaleString()}`);
  logger.info(`Content Hash: ${versionEntry.contentHash}`);
  logger.info(`Full Hash: ${versionEntry.fullHash}`);
  logger.info(`Site Index ID: ${versionEntry.siteIndexId}`);
  if (versionEntry.entrypointId) {
    logger.info(`Entrypoint ID: ${versionEntry.entrypointId}`);
  }
  logger.info(`Default Route: ${versionEntry.defaultRoute}`);
  if (versionEntry.notFoundRoute) {
    logger.info(`404 Route: ${versionEntry.notFoundRoute}`);
  }
  logger.info(`\nRoutes (${versionEntry.routes.length}):`);

  for (const route of versionEntry.routes) {
    const manifestId = versionEntry.routeManifests[route];
    logger.info(`  ${route} → ${manifestId.substring(0, 16)}...`);
  }

  logger.info("");
  logger.separator();
  logger.info("");
}

/**
 * Compare two versions
 */
async function compareVersions(pubkey, npub, version1, version2) {
  const history = await fetchVersionHistory(pubkey, npub);

  const v1 = history.versions.find((v) => v.version === version1);
  const v2 = history.versions.find((v) => v.version === version2);

  if (!v1 || !v2) {
    logger.error("❌ Version not found");
    if (!v1) logger.error(`   ${version1} not found`);
    if (!v2) logger.error(`   ${version2} not found`);
    process.exit(1);
  }

  logger.header("🔍 Version Comparison");
  logger.info(
    `${version1} (${new Date(
      v1.timestamp
    ).toLocaleDateString()}) ↔️ ${version2} (${new Date(
      v2.timestamp
    ).toLocaleDateString()})`
  );
  logger.separator();
  logger.info("");

  // Compare routes
  const routes1 = new Set(v1.routes);
  const routes2 = new Set(v2.routes);

  const added = [...routes2].filter((r) => !routes1.has(r));
  const removed = [...routes1].filter((r) => !routes2.has(r));
  const unchanged = [...routes1].filter((r) => routes2.has(r));

  // Check for modified routes (same route, different manifest)
  const modified = unchanged.filter((route) => {
    return v1.routeManifests[route] !== v2.routeManifests[route];
  });

  if (added.length > 0) {
    logger.success(`✅ Routes Added (${added.length}):`);
    added.forEach((r) => {
      const manifestId = v2.routeManifests[r];
      logger.info(`   + ${r} (${manifestId.substring(0, 8)}...)`);
    });
    logger.info("");
  }

  if (removed.length > 0) {
    logger.error(`❌ Routes Removed (${removed.length}):`);
    removed.forEach((r) => {
      const manifestId = v1.routeManifests[r];
      logger.info(`   - ${r} (${manifestId.substring(0, 8)}...)`);
    });
    logger.info("");
  }

  if (modified.length > 0) {
    logger.warn(`🔄 Routes Modified (${modified.length}):`);
    modified.forEach((r) => {
      const oldManifest = v1.routeManifests[r].substring(0, 8);
      const newManifest = v2.routeManifests[r].substring(0, 8);
      logger.info(`   ≈ ${r}`);
      logger.info(`     ${oldManifest}... → ${newManifest}...`);
    });
    logger.info("");
  }

  const trulyUnchanged = unchanged.filter((r) => !modified.includes(r));

  if (trulyUnchanged.length > 0) {
    logger.info(`   Routes Unchanged (${trulyUnchanged.length}):`);
    trulyUnchanged.forEach((r) => logger.info(`     ${r}`));
    logger.info("");
  }

  // Summary
  logger.info("Summary:");
  logger.info(`  Total routes in ${version1}: ${routes1.size}`);
  logger.info(`  Total routes in ${version2}: ${routes2.size}`);
  logger.info(`  Added: ${added.length}`);
  logger.info(`  Removed: ${removed.length}`);
  logger.info(`  Modified: ${modified.length}`);
  logger.info(`  Unchanged: ${trulyUnchanged.length}`);
  logger.info(
    `  Time elapsed: ${Math.abs(v2.created_at - v1.created_at)} seconds`
  );
  logger.info("");
  logger.separator();
  logger.info("");
}

/**
 * Main function
 */
async function main() {
  try {
    const args = process.argv.slice(2);

    // Show help
    if (args.includes("--help") || args.includes("-h")) {
      console.log(`
📚 Nostr Web Versions

Manage site versions - list, show, compare, and track version history.

Usage: nw-publisher versions <command> [npub|hex] [options]

Commands:
  list                           List all versions from relays
  show <version>                 Show details for a specific version
  compare <version1> <version2>  Compare two versions
  current                        Show current version

Arguments:
  npub              Query by npub (e.g., npub1...)
  hex               Query by hex pubkey (64 characters)

Examples:
  # Use .env configuration
 nw-publisher versions list
 nw-publisher versions show 0.2.0
 nw-publisher versions compare 0.1.0 0.2.0
 nw-publisher versions current
  
  # Query any site by npub (no private key needed!)
 nw-publisher versions list npub1...
 nw-publisher versions show npub1... 0.2.0
 nw-publisher versions compare npub1... 0.1.0 0.2.0
  
  # Query by hex pubkey
 nw-publisher versions list a1b2c3d4e5f6...
`);
      return;
    }

    const [command, pubkeyArg, ...commandArgs] = args;

    if (!command) {
      console.log("Use --help for usage information");
      return;
    }

    // Get pubkey (from arg or environment)
    let pubkey, npub;
    let identifierProvided = false;

    if (!pubkeyArg) {
      // No argument - use environment
      const result = getPubkey(null);
      pubkey = result.pubkey;
      npub = result.npub;
    } else if (
      pubkeyArg.startsWith("npub1") ||
      /^[0-9a-f]{64}$/i.test(pubkeyArg)
    ) {
      // It's an npub or hex pubkey
      identifierProvided = true;
      const result = getPubkey(pubkeyArg);
      pubkey = result.pubkey;
      npub = result.npub;
    } else {
      // Not a valid pubkey - treat as version argument for the command
      const result = getPubkey(null);
      pubkey = result.pubkey;
      npub = result.npub;
    }

    // Adjust args based on whether an identifier was provided
    const adjustedArgs = identifierProvided
      ? commandArgs
      : [pubkeyArg, ...commandArgs].filter(Boolean);

    switch (command) {
      case "list":
        await listVersions(pubkey, npub);
        break;

      case "show":
        if (adjustedArgs.length === 0) {
          throw new ValidationError(
            "Please specify a version. Usage: nw-publisher versions show [npub|hex|site] <version>"
          );
        }
        await showVersion(pubkey, npub, adjustedArgs[0]);
        break;

      case "compare":
        if (adjustedArgs.length < 2) {
          throw new ValidationError(
            "Please specify two versions. Usage: nw-publisher versions compare [npub|hex|site] <version1> <version2>"
          );
        }
        await compareVersions(pubkey, npub, adjustedArgs[0], adjustedArgs[1]);
        break;

      case "current":
        const history = await fetchVersionHistory(pubkey, npub);
        logger.info(`\nCurrent version: ${history.current}\n`);
        break;

      default:
        throw new ValidationError(
          `Unknown command: ${command}. Use --help for usage.`
        );
    }

    // Explicitly exit to prevent hanging connections
    process.exit(0);
  } catch (error) {
    handleError(error);
    process.exit(1);
  }
}

// Run
main();
