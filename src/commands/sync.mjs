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
  publishEvent,
} from "../lib/relay.mjs";
import { groupEventsByKind, getEventId, createDeletionEvent } from "../lib/events.mjs";
import { logger } from "../utils/logger.mjs";
import { handleError, ConfigError } from "../utils/errors.mjs";
import { nip19 } from "nostr-tools";

// Load .env from current working directory
dotenv.config({ path: process.cwd() + '/.env' });

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
 * STEP A: Analyze entrypoints across all relays
 * Find the newest entrypoint and which site index it points to
 * 
 * @param {Map} relayEvents - Map of relay URL to events array
 * @returns {Object} Entrypoint analysis
 */
function analyzeEntrypoints(relayEvents) {
  const entrypointsByRelay = new Map();
  let newestEntrypoint = null;
  let targetSiteIndexDTag = null;
  
  for (const [relayUrl, events] of relayEvents.entries()) {
    const entrypoints = events.filter(e => e.kind === EVENT_KINDS.ENTRYPOINT);
    
    if (entrypoints.length > 0) {
      const newest = entrypoints.reduce((prev, curr) => 
        curr.created_at > prev.created_at ? curr : prev
      );
      
      entrypointsByRelay.set(relayUrl, entrypoints);
      
      if (!newestEntrypoint || newest.created_at > newestEntrypoint.created_at) {
        newestEntrypoint = newest;
        const aTag = newest.tags.find(t => t[0] === 'a')?.[1];
        if (aTag) {
          const parts = aTag.split(':');
          targetSiteIndexDTag = parts[2]; // Extract d-tag: "31126:pubkey:d-tag"
        }
      }
    }
  }
  
  return {
    entrypointsByRelay,
    newestEntrypoint,
    targetSiteIndexDTag
  };
}

/**
 * STEP B: Retrieve all site indexes and identify versions
 * 
 * @param {Map} relayEvents - Map of relay URL to events array
 * @returns {Map} Map of version string to version data
 */
function analyzeSiteIndexVersions(relayEvents) {
  const versionMap = new Map(); // version -> { siteIndexes: [{relay, event, dTag}], routes }
  
  for (const [relayUrl, events] of relayEvents.entries()) {
    const siteIndexes = events.filter(e => e.kind === EVENT_KINDS.SITE_INDEX);
    
    for (const siteIndex of siteIndexes) {
      try {
        const content = JSON.parse(siteIndex.content);
        const version = content.version || 'unknown';
        const dTag = siteIndex.tags.find(t => t[0] === 'd')?.[1];
        const eventId = getEventId(siteIndex);
        
        if (!versionMap.has(version)) {
          versionMap.set(version, {
            version,
            siteIndexes: [],
            routes: content.routes || {},
            manifestIds: new Set()
          });
        }
        
        versionMap.get(version).siteIndexes.push({
          relay: relayUrl,
          event: siteIndex,
          dTag,
          eventId
        });
        
        // Collect manifest IDs from routes
        Object.values(content.routes || {}).forEach(manifestId => {
          versionMap.get(version).manifestIds.add(manifestId);
        });
      } catch (e) {
        logger.debug(`Failed to parse site index: ${e.message}`);
      }
    }
  }
  
  return versionMap;
}

/**
 * STEP C: Check version completeness on each relay
 * Verify that all versions have complete resources (assets + manifests + site index)
 * 
 * @param {Map} relayEvents - Map of relay URL to events array
 * @param {Map} versionMap - Map of versions
 * @param {Array} relays - List of all relay URLs
 * @returns {Object} Completeness analysis
 */
function analyzeVersionCompleteness(relayEvents, versionMap, relays) {
  const relayVersionStatus = new Map(); // relay -> version -> {status, missing}
  const versionCompleteness = new Map(); // version -> {completeOn: [], partialOn: [], missingOn: []}
  
  // Initialize
  for (const relay of relays) {
    relayVersionStatus.set(relay, new Map());
  }
  
  for (const version of versionMap.keys()) {
    versionCompleteness.set(version, {
      completeOn: [],
      partialOn: [],
      missingOn: []
    });
  }
  
  // Check each version on each relay
  for (const [version, versionInfo] of versionMap.entries()) {
    for (const relay of relays) {
      const events = relayEvents.get(relay) || [];
      const status = {
        hasSiteIndex: false,
        manifests: { required: versionInfo.manifestIds.size, present: 0 },
        assets: { required: 0, present: 0 },
        missingManifests: [],
        missingAssets: []
      };
      
      // Check site index
      status.hasSiteIndex = versionInfo.siteIndexes.some(si => si.relay === relay);
      
      if (!status.hasSiteIndex) {
        versionCompleteness.get(version).missingOn.push(relay);
        relayVersionStatus.get(relay).set(version, status);
        continue;
      }
      
      // Check manifests
      const presentManifests = new Map(); // manifestId -> manifest event
      for (const manifestId of versionInfo.manifestIds) {
        const manifest = events.find(e => 
          e.kind === EVENT_KINDS.MANIFEST && getEventId(e) === manifestId
        );
        if (manifest) {
          presentManifests.set(manifestId, manifest);
          status.manifests.present++;
        } else {
          status.missingManifests.push(manifestId);
        }
      }
      
      // Check assets (from manifests)
      const requiredAssets = new Set();
      for (const manifest of presentManifests.values()) {
        manifest.tags.filter(t => t[0] === 'e').forEach(t => {
          requiredAssets.add(t[1]);
        });
      }
      
      status.assets.required = requiredAssets.size;
      
      for (const assetId of requiredAssets) {
        const hasAsset = events.some(e => 
          e.kind === EVENT_KINDS.ASSET && getEventId(e) === assetId
        );
        if (hasAsset) {
          status.assets.present++;
        } else {
          status.missingAssets.push(assetId);
        }
      }
      
      // Determine completeness
      const isComplete = 
        status.manifests.present === status.manifests.required &&
        status.assets.present === status.assets.required;
      
      if (isComplete) {
        versionCompleteness.get(version).completeOn.push(relay);
      } else {
        versionCompleteness.get(version).partialOn.push(relay);
      }
      
      relayVersionStatus.get(relay).set(version, status);
    }
  }
  
  return { relayVersionStatus, versionCompleteness };
}

/**
 * STEP D: Identify source relays for each version
 * Pick a relay that has complete resources for each version
 * 
 * @param {Map} versionCompleteness - Version completeness map
 * @returns {Map} Map of version to source relay URL
 */
function identifySourceRelays(versionCompleteness) {
  const sourceRelays = new Map();
  
  for (const [version, completeness] of versionCompleteness.entries()) {
    if (completeness.completeOn.length > 0) {
      // Pick first complete relay as source
      sourceRelays.set(version, completeness.completeOn[0]);
    } else {
      // No complete source - version is orphaned
      sourceRelays.set(version, null);
    }
  }
  
  return sourceRelays;
}

/**
 * STEP E & F: Build complete sync plan
 * - Delete incomplete/orphaned versions
 * - Sync complete versions from source relays
 * - Update entrypoints to point to correct site index
 * 
 * @param {Map} relayEvents - Map of relay URL to events
 * @param {Map} versionMap - Map of versions
 * @param {Map} sourceRelays - Map of version to source relay
 * @param {Object} entrypointAnalysis - Entrypoint analysis
 * @param {Map} relayVersionStatus - Status of each version on each relay
 * @param {Array} relays - List of all relays
 * @param {string} skHex - Private key for signing deletion events
 * @returns {Map} Sync plan for each relay
 */
function buildSyncPlan(relayEvents, versionMap, sourceRelays, entrypointAnalysis, relayVersionStatus, relays, skHex) {
  const syncPlan = new Map();
  
  for (const relay of relays) {
    syncPlan.set(relay, {
      deleteOrphanedAssets: [],        // Orphaned assets to delete
      deleteOrphanedManifests: [],     // Orphaned manifests to delete
      deleteIncompleteSiteIndexes: [], // Incomplete site indexes to delete
      deleteOldEntrypoints: [],        // Old entrypoint events to delete
      syncAssets: [],                  // Assets to sync
      syncManifests: [],               // Manifests to sync
      syncSiteIndexes: [],             // Site indexes to sync
      syncNewEntrypoint: null          // New entrypoint to publish
    });
  }
  
  // Process each version
  for (const [version, versionInfo] of versionMap.entries()) {
    const sourceRelay = sourceRelays.get(version);
    
    if (!sourceRelay) {
      // Orphaned version - delete from all relays
      logger.warn(`Version ${version} has no complete source - will delete from all relays`);
      
      for (const relay of relays) {
        const status = relayVersionStatus.get(relay).get(version);
        if (status && status.hasSiteIndex) {
          const plan = syncPlan.get(relay);
          const siteIndex = versionInfo.siteIndexes.find(si => si.relay === relay);
          if (siteIndex) {
            plan.deleteIncompleteSiteIndexes.push(siteIndex.event);
          }
          // TODO: Also delete manifests and assets for orphaned versions
        }
      }
      continue;
    }
    
    // Get complete resources from source relay
    const sourceEvents = relayEvents.get(sourceRelay);
    const sourceSiteIndex = versionInfo.siteIndexes.find(si => si.relay === sourceRelay);
    
    if (!sourceSiteIndex) continue;
    
    // Collect manifests and assets from source
    const versionManifests = [];
    const versionAssets = [];
    
    for (const manifestId of versionInfo.manifestIds) {
      const manifest = sourceEvents.find(e => 
        e.kind === EVENT_KINDS.MANIFEST && getEventId(e) === manifestId
      );
      
      if (manifest) {
        versionManifests.push(manifest);
        
        // Get assets from manifest
        manifest.tags.filter(t => t[0] === 'e').forEach(t => {
          const assetId = t[1];
          const asset = sourceEvents.find(e => 
            e.kind === EVENT_KINDS.ASSET && getEventId(e) === assetId
          );
          if (asset) {
            // Avoid duplicates
            if (!versionAssets.some(a => getEventId(a) === assetId)) {
              versionAssets.push(asset);
            }
          }
        });
      }
    }
    
    // Sync to other relays
    for (const targetRelay of relays) {
      if (targetRelay === sourceRelay) continue;
      
      const status = relayVersionStatus.get(targetRelay).get(version);
      const plan = syncPlan.get(targetRelay);
      
      if (!status || !status.hasSiteIndex) {
        // Version completely missing - sync everything
        plan.syncSiteIndexes.push(sourceSiteIndex.event);
        plan.syncManifests.push(...versionManifests);
        plan.syncAssets.push(...versionAssets);
      } else if (status.missingManifests.length > 0 || status.missingAssets.length > 0) {
        // Version incomplete - sync missing parts
        const missingManifests = versionManifests.filter(m => 
          status.missingManifests.includes(getEventId(m))
        );
        const missingAssets = versionAssets.filter(a => 
          status.missingAssets.includes(getEventId(a))
        );
        
        plan.syncManifests.push(...missingManifests);
        plan.syncAssets.push(...missingAssets);
      }
    }
  }
  
  // STEP F: Handle entrypoints
  if (entrypointAnalysis.newestEntrypoint && entrypointAnalysis.targetSiteIndexDTag) {
    for (const [relay, plan] of syncPlan.entries()) {
      const relayEntrypoints = entrypointAnalysis.entrypointsByRelay.get(relay) || [];
      const oldEntrypoints = [];
      
      for (const entrypoint of relayEntrypoints) {
        const aTag = entrypoint.tags.find(t => t[0] === 'a')?.[1];
        const currentDTag = aTag ? aTag.split(':')[2] : null;
        
        if (currentDTag !== entrypointAnalysis.targetSiteIndexDTag) {
          // Wrong/old entrypoint - collect for deletion
          oldEntrypoints.push(entrypoint.id);
        }
      }
      
      // Create a single deletion event for all old entrypoints on this relay
      if (oldEntrypoints.length > 0) {
        const deletionEvent = createDeletionEvent(
          oldEntrypoints,
          "Replacing old entrypoint with updated version",
          skHex
        );
        plan.deleteOldEntrypoints.push(deletionEvent);
      }
      
      // Always publish the correct entrypoint if needed
      const hasCorrectEntrypoint = relayEntrypoints.some(e => {
        const aTag = e.tags.find(t => t[0] === 'a')?.[1];
        const dTag = aTag ? aTag.split(':')[2] : null;
        return dTag === entrypointAnalysis.targetSiteIndexDTag;
      });
      
      if (!hasCorrectEntrypoint) {
        plan.syncNewEntrypoint = entrypointAnalysis.newestEntrypoint;
      }
    }
  }
  
  return syncPlan;
}

/**
 * Execute the complete sync plan for all relays
 * Implements the bottom-up architecture
 *
 * @param {Array<string>} relays - List of relay URLs
 * @param {string} pubkey - Author public key
 * @param {string} skHex - Private key for signing events
 * @returns {Promise<Object>} Sync results
 */
async function buildEventMap(relays, pubkey, skHex) {
  const relayEvents = new Map();

  logger.info("\n🔍 Scanning relays for events...\n");

  // Collect all events from all relays
  for (const relayUrl of relays) {
    logger.info(`   Querying ${relayUrl}...`);
    const events = await queryAllEvents(relayUrl, pubkey);
    logger.info(`      Found ${events.length} events`);
    relayEvents.set(relayUrl, events);
  }

  // STEP A: Analyze entrypoints
  logger.info(`\n📍 Step A: Analyzing entrypoints...`);
  const entrypointAnalysis = analyzeEntrypoints(relayEvents);
  
  if (entrypointAnalysis.newestEntrypoint) {
    logger.info(`   Target site index: ${entrypointAnalysis.targetSiteIndexDTag}`);
  } else {
    logger.warn(`   No entrypoints found!`);
  }
  
  // STEP B: Analyze versions
  logger.info(`\n📦 Step B: Analyzing versions...`);
  const versionMap = analyzeSiteIndexVersions(relayEvents);
  const versions = Array.from(versionMap.keys()).sort();
  logger.info(`   Found ${versions.length} version(s): ${versions.join(', ')}`);
  
  // STEP C: Check completeness
  logger.info(`\n✅ Step C: Checking version completeness...`);
  const { relayVersionStatus, versionCompleteness } = analyzeVersionCompleteness(
    relayEvents, versionMap, relays
  );
  
  for (const [version, completeness] of versionCompleteness.entries()) {
    const complete = completeness.completeOn.length;
    const partial = completeness.partialOn.length;
    const missing = completeness.missingOn.length;
    
    if (complete > 0) {
      logger.info(`   v${version}: ✓ Complete on ${complete} relay(s), partial on ${partial}, missing on ${missing}`);
    } else if (partial > 0) {
      logger.warn(`   v${version}: ⚠️  No complete source (partial on ${partial} relay(s)) - will be deleted`);
    } else {
      logger.warn(`   v${version}: ❌ Missing on all relays`);
    }
  }
  
  // STEP D: Identify sources
  logger.info(`\n🎯 Step D: Identifying source relays...`);
  const sourceRelays = identifySourceRelays(versionCompleteness);
  
  for (const [version, sourceRelay] of sourceRelays.entries()) {
    if (sourceRelay) {
      logger.info(`   v${version}: ${sourceRelay}`);
    } else {
      logger.warn(`   v${version}: No complete source (orphaned)`);
    }
  }
  
  // STEP E & F: Build sync plan
  logger.info(`\n🔄 Step E & F: Building sync plan...\n`);
  const syncPlan = buildSyncPlan(
    relayEvents,
    versionMap,
    sourceRelays,
    entrypointAnalysis,
    relayVersionStatus,
    relays,
    skHex
  );
  
  return {
    syncPlan,
    versionMap,
    entrypointAnalysis,
    sourceRelays
  };
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
 * Display the sync plan
 * Shows what will be deleted and what will be synced for each relay
 * 
 * @param {Map} syncPlan - The sync plan from buildSyncPlan
 * @param {Map} versionMap - Version mapping from analyzeSiteIndexVersions
 * @returns {Object} Summary statistics
 */
function displaySyncPlan(syncPlan, versionMap) {
  logger.info("\n📋 Sync Plan:\n");
  
  let totalDeletions = 0;
  let totalSyncs = 0;
  let relaysWithActions = 0;
  
  // Display per-relay plans
  for (const [relayUrl, plan] of syncPlan.entries()) {
    const deletions = [
      ...plan.deleteOrphanedAssets,
      ...plan.deleteOrphanedManifests,
      ...plan.deleteIncompleteSiteIndexes,
      ...plan.deleteOldEntrypoints
    ];
    
    const syncs = [
      ...plan.syncAssets,
      ...plan.syncManifests,
      ...plan.syncSiteIndexes,
      ...(plan.syncNewEntrypoint ? [plan.syncNewEntrypoint] : [])
    ];
    
    if (deletions.length === 0 && syncs.length === 0) {
      logger.success(`   ${relayUrl}: ✓ Complete`);
      continue;
    }
    
    relaysWithActions++;
    logger.warn(`\n   ${relayUrl}: Needs attention`);
    
    // Show deletions
    if (deletions.length > 0) {
      totalDeletions += deletions.length;
      logger.error(`      🗑️  Deletions: ${deletions.length} events`);
      
      if (plan.deleteOldEntrypoints.length > 0) {
        logger.info(`         - ${plan.deleteOldEntrypoints.length} old entrypoint(s)`);
      }
      if (plan.deleteIncompleteSiteIndexes.length > 0) {
        logger.info(`         - ${plan.deleteIncompleteSiteIndexes.length} incomplete site index(es)`);
      }
      if (plan.deleteOrphanedManifests.length > 0) {
        logger.info(`         - ${plan.deleteOrphanedManifests.length} orphaned manifest(s)`);
      }
      if (plan.deleteOrphanedAssets.length > 0) {
        logger.info(`         - ${plan.deleteOrphanedAssets.length} orphaned asset(s)`);
      }
    }
    
    // Show syncs
    if (syncs.length > 0) {
      totalSyncs += syncs.length;
      logger.info(`      📥 Syncs: ${syncs.length} events`);
      
      if (plan.syncNewEntrypoint) {
        logger.info(`         - 1 new entrypoint`);
      }
      if (plan.syncSiteIndexes.length > 0) {
        logger.info(`         - ${plan.syncSiteIndexes.length} site index(es)`);
      }
      if (plan.syncManifests.length > 0) {
        logger.info(`         - ${plan.syncManifests.length} manifest(s)`);
      }
      if (plan.syncAssets.length > 0) {
        logger.info(`         - ${plan.syncAssets.length} asset(s)`);
      }
    }
  }
  
  // Summary
  if (totalDeletions === 0 && totalSyncs === 0) {
    logger.success("\n✅ All relays are in sync!");
    logger.info("   All versions exist consistently on all configured relays.\n");
    return { totalDeletions: 0, totalSyncs: 0, relaysWithActions: 0 };
  }
  
  logger.info("");
  logger.separator();
  logger.warn(`Total Actions Required: ${totalDeletions + totalSyncs} events`);
  if (totalDeletions > 0) {
    logger.error(`   🗑️  Deletions: ${totalDeletions}`);
  }
  if (totalSyncs > 0) {
    logger.info(`   📥 Syncs: ${totalSyncs}`);
  }
  logger.warn(`   📡 Relays needing updates: ${relaysWithActions}`);
  logger.separator();
  logger.info("");
  
  return { totalDeletions, totalSyncs, relaysWithActions };
}

/**
 * Execute the sync plan
 * Deletes old/orphaned events and syncs missing events in proper order
 * 
 * @param {Object} syncPlan - The sync plan from buildSyncPlan
 * @param {Array} relays - Array of relay URLs
 * @returns {Object} Execution statistics
 */
async function executeSyncPlan(syncPlan, relays) {
  logger.info("\n🔄 Starting synchronization...");
  
  const stats = {
    totalDeleted: 0,
    totalPublished: 0,
    totalFailed: 0,
    relaysUpdated: 0,
  };
  
  // Process each relay
  for (const relayUrl of relays) {
    const plan = syncPlan.get(relayUrl);
    if (!plan) continue;
    
    const deletions = [
      ...plan.deleteOrphanedAssets,
      ...plan.deleteOrphanedManifests,
      ...plan.deleteIncompleteSiteIndexes,
      ...plan.deleteOldEntrypoints
    ];
    
    const syncs = [
      ...plan.syncAssets,
      ...plan.syncManifests,
      ...plan.syncSiteIndexes,
      ...(plan.syncNewEntrypoint ? [plan.syncNewEntrypoint] : [])
    ];
    
    if (deletions.length === 0 && syncs.length === 0) {
      continue; // Skip relays with no actions
    }
    
    logger.info(`\n📡 ${relayUrl}...`);
    
    try {
      const relay = await connectToRelay(relayUrl);
      let relayUpdated = false;
      
      // Step 1: Delete old/orphaned events
      if (deletions.length > 0) {
        logger.info(`   🗑️  Deleting ${deletions.length} events...`);
        let deleted = 0;
        let deleteFailed = 0;
        
        for (const event of deletions) {
          try {
            await relay.publish(event);
            deleted++;
            stats.totalDeleted++;
            process.stdout.write("🗑");
          } catch (e) {
            deleteFailed++;
            stats.totalFailed++;
            process.stdout.write("✗");
            logger.debug(`Failed to delete event ${event.id}: ${e.message}`);
          }
        }
        
        logger.info(`\n      ✓ Deleted: ${deleted}/${deletions.length}`);
        if (deleteFailed > 0) {
          logger.warn(`      ✗ Failed: ${deleteFailed}`);
        }
        
        if (deleted > 0) {
          relayUpdated = true;
        }
      }
      
      // Step 2: Sync missing events (bottom-up: assets → manifests → site indexes → entrypoints)
      if (syncs.length > 0) {
        logger.info(`   📥 Publishing ${syncs.length} events...`);
        let published = 0;
        let publishFailed = 0;
        
        // Sort events: assets (1125) → manifests (1126) → site indexes (31126) → entrypoints (11126)
        const kindOrder = {
          [EVENT_KINDS.ASSET]: 1,
          [EVENT_KINDS.MANIFEST]: 2,
          [EVENT_KINDS.SITE_INDEX]: 3,
          [EVENT_KINDS.ENTRYPOINT]: 4,
        };
        
        const sorted = syncs.sort((a, b) => {
          return (kindOrder[a.kind] || 99) - (kindOrder[b.kind] || 99);
        });
        
        for (const event of sorted) {
          try {
            await relay.publish(event);
            published++;
            stats.totalPublished++;
            process.stdout.write(".");
          } catch (e) {
            publishFailed++;
            stats.totalFailed++;
            process.stdout.write("✗");
            logger.debug(`Failed to publish event ${event.id}: ${e.message}`);
          }
        }
        
        logger.info(`\n      ✓ Published: ${published}/${syncs.length}`);
        if (publishFailed > 0) {
          logger.warn(`      ✗ Failed: ${publishFailed}`);
        }
        
        if (published > 0) {
          relayUpdated = true;
        }
      }
      
      if (relayUpdated) {
        stats.relaysUpdated++;
      }
      
      closeRelay(relay);
    } catch (e) {
      logger.error(`   ✗ Connection failed: ${e.message}`);
      stats.totalFailed += deletions.length + syncs.length;
    }
  }
  
  return stats;
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

    // Build sync plan using new architecture
    logger.info("\n📊 Analyzing relay states...");
    const { syncPlan, versionMap, entrypointAnalysis, sourceRelays } = await buildEventMap(relays, pubkey, skHex);

    // Display version information
    if (versionMap.size === 0) {
      logger.error(
        "❌ No versions found. Deploy your site first with: nw-publisher deploy\n"
      );
      process.exit(0);
    }

    logger.info(`📦 Detected versions: ${versionMap.size}\n`);
    for (const [version, data] of versionMap.entries()) {
      const relayList = data.siteIndexes.map(si => si.relay);
      const uniqueRelays = [...new Set(relayList)];
      logger.info(`   v${version}: Found on ${uniqueRelays.length} relay(s)`);
    }

    // Display entrypoint status
    if (entrypointAnalysis.newestEntrypoint) {
      logger.info(`\n🎯 Current entrypoint: ${entrypointAnalysis.newestEntrypoint.id.substring(0, 8)}...`);
      logger.info(`   → Points to site index: ${entrypointAnalysis.targetSiteIndexDTag}`);
      
      // Count old entrypoints from sync plan
      let oldEntrypointCount = 0;
      for (const [_, plan] of syncPlan.entries()) {
        oldEntrypointCount += plan.deleteOldEntrypoints.length;
      }
      
      if (oldEntrypointCount > 0) {
        logger.warn(`   ⚠️  Found ${oldEntrypointCount} old entrypoint(s) to delete`);
      }
    } else {
      logger.warn("\n⚠️  No entrypoint found");
    }

    // Display source relays for complete versions
    if (sourceRelays.size > 0) {
      logger.info(`\n📍 Source relays (complete versions):`);
      for (const [version, relayUrl] of sourceRelays.entries()) {
        if (relayUrl) {
          logger.info(`   v${version}: ${relayUrl}`);
        }
      }
    }

    // Display sync plan
    const { totalDeletions, totalSyncs, relaysWithActions } = displaySyncPlan(syncPlan, versionMap);

    if (totalDeletions === 0 && totalSyncs === 0) {
      logger.success("\n✅ All relays are in sync!\n");
      return;
    }

    logger.warn(`\n⚠️  ${relaysWithActions} relay(s) need synchronization`);
    logger.warn(`   ${totalDeletions} deletions + ${totalSyncs} publications = ${totalDeletions + totalSyncs} total actions\n`);

    // Confirm sync
    const rl = readline.createInterface({ input, output });
    const answer = await rl.question('Type "SYNC" to execute the sync plan: ');
    rl.close();

    if (answer.trim() !== "SYNC") {
      logger.info("\n❌ Sync cancelled.\n");
      return;
    }

    // Execute sync plan
    const stats = await executeSyncPlan(syncPlan, relays);

    // Summary
    logger.info("");
    logger.separator();
    logger.info("📊 SYNC SUMMARY");
    logger.separator();
    logger.info("");

    if (stats.totalDeleted > 0) {
      logger.info(`🗑️  Deleted: ${stats.totalDeleted} events`);
    }
    logger.success(`📥 Published: ${stats.totalPublished} events`);
    if (stats.totalFailed > 0) {
      logger.error(`❌ Failed: ${stats.totalFailed} events`);
    }
    logger.info(
      `📡 Relays updated: ${stats.relaysUpdated}/${relaysWithActions}`
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
