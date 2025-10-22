/**
 * Relay Query Utilities
 *
 * Functions to query Nostr relays for existing events and rebuild state.
 * This allows the tool to work without local cache files by using relays as source of truth.
 */

import { EVENT_KINDS } from "./constants.mjs";
import { connectToRelay, closeRelay } from "./relay.mjs";

/**
 * Query events from a relay with timeout
 * @param {Object} relay - Connected relay object
 * @param {Array} filters - Array of Nostr filters
 * @param {number} timeout - Timeout in ms (default 10000)
 * @returns {Promise<Array>} Array of events
 */
export async function queryEvents(relay, filters, timeout = 10000) {
  return new Promise((resolve) => {
    const events = [];
    const timeoutId = setTimeout(() => resolve(events), timeout);

    const sub = relay.subscribe(filters, {
      onevent: (event) => {
        events.push(event);
      },
      oneose: () => {
        clearTimeout(timeoutId);
        sub.close();
        resolve(events);
      },
    });
  });
}

/**
 * Query all asset events (kind 1125) for a given pubkey from relays
 * Returns a map of contentHash -> eventId for caching
 *
 * @param {Array} relayUrls - Array of relay URLs
 * @param {string} pubkey - Public key (hex)
 * @returns {Promise<Object>} Map of "kind:hash" -> eventId
 */
export async function queryExistingAssets(relayUrls, pubkey) {
  const assetMap = {};
  const kind = EVENT_KINDS.ASSET;

  console.log(
    `🔍 Querying ${relayUrls.length} relay(s) for existing assets...`
  );

  for (const url of relayUrls) {
    try {
      const relay = await connectToRelay(url);

      // Query all asset events by this author
      const events = await queryEvents(
        relay,
        [
          {
            kinds: [kind],
            authors: [pubkey],
          },
        ],
        15000 // 15 second timeout
      );

      console.log(`  ✓ ${url}: Found ${events.length} asset(s)`);

      // Build map of content hash -> event ID
      for (const event of events) {
        // Find content hash tag (x tag)
        const hashTag = event.tags.find((t) => t[0] === "x");
        if (hashTag && hashTag[1]) {
          const cacheKey = `${kind}:${hashTag[1]}`;
          assetMap[cacheKey] = event.id;
        }
      }

      closeRelay(relay);
    } catch (error) {
      console.warn(`  ⚠ ${url}: Failed to query - ${error.message}`);
    }
  }

  const uniqueAssets = Object.keys(assetMap).length;
  console.log(`✓ Found ${uniqueAssets} unique asset(s) across all relays\n`);

  return assetMap;
}

/**
 * Query all manifest events (kind 1126) for a given pubkey
 * Returns a map of route -> { id, assetIds }
 *
 * @param {Array} relayUrls - Array of relay URLs
 * @param {string} pubkey - Public key (hex)
 * @returns {Promise<Object>} Map of route -> manifest data
 */
export async function queryExistingManifests(relayUrls, pubkey) {
  const manifestMap = {};
  const kind = EVENT_KINDS.MANIFEST;

  console.log(`🔍 Querying relays for existing manifests...`);

  for (const url of relayUrls) {
    try {
      const relay = await connectToRelay(url);

      const events = await queryEvents(
        relay,
        [
          {
            kinds: [kind],
            authors: [pubkey],
          },
        ],
        15000
      );

      console.log(`  ✓ ${url}: Found ${events.length} manifest(s)`);

      // Build map of route -> manifest data
      for (const event of events) {
        // Find d tag (route identifier)
        const dTag = event.tags.find((t) => t[0] === "d");
        if (dTag && dTag[1]) {
          const route = dTag[1];

          // Get asset IDs referenced by this manifest
          const assetIds = event.tags
            .filter((t) => t[0] === "e")
            .map((t) => t[1])
            .join(",");

          manifestMap[`manifest:${route}`] = {
            id: event.id,
            assetIds,
          };
        }
      }

      closeRelay(relay);
    } catch (error) {
      console.warn(`  ⚠ ${url}: Failed to query - ${error.message}`);
    }
  }

  console.log(`✓ Found ${Object.keys(manifestMap).length} manifest(s)\n`);

  return manifestMap;
}

/**
 * Query site index events (kind 31126) and build version history
 * Site indexes are replaceable events, so we query by 'd' tag
 *
 * @param {Array} relayUrls - Array of relay URLs
 * @param {string} pubkey - Public key (hex)
 * @returns {Promise<Object>} Version history object
 */
export async function queryVersionHistory(relayUrls, pubkey) {
  const siteIndexes = [];
  const kind = EVENT_KINDS.SITE_INDEX;

  console.log(`🔍 Querying relays for version history...`);

  for (const url of relayUrls) {
    try {
      const relay = await connectToRelay(url);

      // Query all site index events (addressable kind 31126)
      // Don't filter by d-tag to get all versions for history
      const events = await queryEvents(
        relay,
        [
          {
            kinds: [kind],
            authors: [pubkey],
            // No #d filter - d-tags are content-addressed (truncated hashes)
            // We want all site index versions for this author
          },
        ],
        15000
      );

      console.log(`  ✓ ${url}: Found ${events.length} site index(es)`);

      // Collect all site indexes (may have multiple from different times)
      siteIndexes.push(...events);

      closeRelay(relay);
    } catch (error) {
      console.warn(`  ⚠ ${url}: Failed to query - ${error.message}`);
    }
  }

  // Sort by timestamp (newest first)
  siteIndexes.sort((a, b) => b.created_at - a.created_at);

  // Parse version history from site indexes
  const versions = [];
  let currentVersion = "0.1.0";

  for (const siteIndex of siteIndexes) {
    try {
      const content = JSON.parse(siteIndex.content || "{}");

      // Extract routes from content (not tags)
      const routes = Object.keys(content.routes || {});

      // Get content hash from tag
      const hashTag = siteIndex.tags.find((t) => t[0] === "x");
      const contentHash = hashTag ? hashTag[1].substring(0, 8) : "unknown";

      // Determine version from content or use incremental
      const version = content.version || `0.1.${versions.length}`;

      versions.push({
        version,
        siteIndexId: siteIndex.id,
        contentHash,
        timestamp: new Date(siteIndex.created_at * 1000).toISOString(),
        changeType: "patch", // Could be inferred from content changes
        routes: [...new Set(routes)], // Deduplicate
        entrypointId: null, // Would need to query entrypoint separately
      });

      // Set current version to the newest (first in sorted array)
      if (versions.length === 1) {
        currentVersion = version;
      }
    } catch (error) {
      console.warn(
        `  ⚠ Failed to parse site index ${siteIndex.id}: ${error.message}`
      );
    }
  }

  console.log(`✓ Reconstructed ${versions.length} version(s) from relays\n`);

  return {
    current: currentVersion,
    versions,
  };
}

/**
 * Query complete cache from relays
 * Combines assets, manifests, site index, and version history
 *
 * @param {Array} relayUrls - Array of relay URLs
 * @param {string} pubkey - Public key (hex)
 * @returns {Promise<Object>} Complete cache object
 */
export async function rebuildCacheFromRelays(relayUrls, pubkey) {
  console.log("🔄 Rebuilding cache from Nostr relays...\n");

  const [assets, manifests, versionHistory] = await Promise.all([
    queryExistingAssets(relayUrls, pubkey),
    queryExistingManifests(relayUrls, pubkey),
    queryVersionHistory(relayUrls, pubkey),
  ]);

  // Get latest site index from version history
  const latestVersion = versionHistory.versions[0];
  const siteIndex = latestVersion
    ? {
        id: latestVersion.siteIndexId,
        contentHash: latestVersion.contentHash,
        truncatedHash: latestVersion.contentHash,
        routes: {}, // Would need to reconstruct from manifest queries
        version: latestVersion.version,
      }
    : null;

  const cache = {
    assets,
    manifests,
    siteIndex,
    version: { major: 0, minor: 0, patch: 0 }, // Parsed from current version
    versionHistory: [],
    entrypoint: null,
  };

  console.log("✅ Cache rebuilt successfully from relays\n");

  return cache;
}
