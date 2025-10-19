/**
 * Cleanup Utilities
 *
 * Shared functions for cleanup and orphan deletion operations.
 */

import { EVENT_KINDS } from "./constants.mjs";
import { connectToRelay, closeRelay, queryEvents } from "./relay.mjs";
import { createDeletionEvent, getEventId } from "./events.mjs";
import { logger } from "../utils/logger.mjs";

/**
 * Query all events from a relay for a given author
 *
 * @param {string} relayUrl - Relay URL
 * @param {string} pubkey - Author public key
 * @returns {Promise<Array>} Array of events
 */
export async function queryAllEventsFromRelay(relayUrl, pubkey) {
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
 * Analyze events to find orphans (unreferenced events)
 *
 * @param {Array} events - All events from a relay
 * @returns {Object} Orphan analysis with arrays of orphaned events by type
 */
export function analyzeOrphans(events) {
  const byKind = {
    [EVENT_KINDS.ASSET]: [],
    [EVENT_KINDS.MANIFEST]: [],
    [EVENT_KINDS.SITE_INDEX]: [],
    [EVENT_KINDS.ENTRYPOINT]: [],
  };

  // Group events by kind
  for (const event of events) {
    if (byKind[event.kind]) {
      byKind[event.kind].push(event);
    }
  }

  // Track referenced event IDs
  const referencedAssets = new Set();
  const referencedManifests = new Set();
  const referencedIndexes = new Set();

  // Step 1: Entrypoints reference site indexes (via 'a' tags)
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

  // Step 2: Site indexes reference manifests (via 'e' tags)
  // Only check indexes that are referenced by entrypoints (or all if no entrypoints)
  for (const index of byKind[EVENT_KINDS.SITE_INDEX]) {
    if (
      referencedIndexes.has(getEventId(index)) ||
      byKind[EVENT_KINDS.ENTRYPOINT].length === 0
    ) {
      for (const tag of index.tags) {
        if (tag[0] === "e") {
          referencedManifests.add(tag[1]);
        }
      }
    }
  }

  // Step 3: Manifests reference assets (via 'e' tags)
  // Only check manifests that are referenced by site indexes (or all if no indexes)
  for (const manifest of byKind[EVENT_KINDS.MANIFEST]) {
    if (
      referencedManifests.has(getEventId(manifest)) ||
      byKind[EVENT_KINDS.SITE_INDEX].length === 0
    ) {
      for (const tag of manifest.tags) {
        if (tag[0] === "e") {
          referencedAssets.add(tag[1]);
        }
      }
    }
  }

  // Identify orphans (events not in the reference sets)
  const orphanedAssets = byKind[EVENT_KINDS.ASSET].filter(
    (e) => !referencedAssets.has(getEventId(e))
  );

  const orphanedManifests = byKind[EVENT_KINDS.MANIFEST].filter(
    (e) => !referencedManifests.has(getEventId(e))
  );

  const orphanedIndexes = byKind[EVENT_KINDS.SITE_INDEX].filter(
    (e) =>
      !referencedIndexes.has(getEventId(e)) &&
      byKind[EVENT_KINDS.ENTRYPOINT].length > 0
  );

  return {
    assets: orphanedAssets,
    manifests: orphanedManifests,
    indexes: orphanedIndexes,
    summary: {
      totalOrphans:
        orphanedAssets.length +
        orphanedManifests.length +
        orphanedIndexes.length,
      orphanedAssets: orphanedAssets.length,
      orphanedManifests: orphanedManifests.length,
      orphanedIndexes: orphanedIndexes.length,
    },
  };
}

/**
 * Delete events from a relay
 *
 * @param {string} relayUrl - Relay URL
 * @param {Array<string>} eventIds - Event IDs to delete
 * @param {string} skHex - Private key for signing deletion events
 * @returns {Promise<Object>} Deletion results {published, failed}
 */
export async function deleteEventsFromRelay(relayUrl, eventIds, skHex) {
  if (eventIds.length === 0) {
    return { published: 0, failed: 0 };
  }

  let published = 0;
  let failed = 0;

  try {
    const relay = await connectToRelay(relayUrl);

    // Delete in batches for efficiency
    const batchSize = 10;
    for (let i = 0; i < eventIds.length; i += batchSize) {
      const batch = eventIds.slice(i, i + batchSize);
      const deleteEvent = createDeletionEvent(batch, "Cleanup", skHex);

      try {
        await relay.publish(deleteEvent);
        published += batch.length;
        process.stdout.write(".");
      } catch (error) {
        failed += batch.length;
        process.stdout.write("✗");
        logger.debug(`Failed to delete batch: ${error.message}`);
      }
    }

    closeRelay(relay);
  } catch (error) {
    logger.warn(`Failed to delete from ${relayUrl}: ${error.message}`);
    failed = eventIds.length - published;
  }

  return { published, failed };
}

/**
 * Group events by kind
 *
 * @param {Array} events - Array of events
 * @returns {Object} Events grouped by kind
 */
export function groupEventsByKind(events) {
  const grouped = {};

  for (const event of events) {
    if (!grouped[event.kind]) {
      grouped[event.kind] = [];
    }
    grouped[event.kind].push(event);
  }

  return grouped;
}
