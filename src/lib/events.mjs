/**
 * Nostr Event Utilities
 *
 * Helper functions for creating and managing Nostr events.
 */

import { finalizeEvent } from "nostr-tools";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { EVENT_KINDS } from "../lib/constants.mjs";
import { hexToUint8Array } from "../lib/keypair.mjs";

/**
 * Create asset event (kind 1125)
 *
 * @param {string} content - File content
 * @param {string} contentHash - SHA256 hash of content
 * @param {string} filename - Original filename
 * @param {string} mimeType - MIME type
 * @param {string} skHex - Private key in hex
 * @returns {Object} Finalized event
 */
export function createAssetEvent(
  content,
  contentHash,
  filename,
  mimeType,
  skHex
) {
  const SK = hexToUint8Array(skHex);

  return finalizeEvent(
    {
      kind: EVENT_KINDS.ASSET,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["x", contentHash],
        ["m", mimeType],
        ["name", filename],
      ],
      content,
    },
    SK
  );
}

/**
 * Create manifest event (kind 1126)
 *
 * @param {string} route - Page route
 * @param {Object} manifest - Manifest data
 * @param {string} skHex - Private key in hex
 * @returns {Object} Finalized event
 */
export function createManifestEvent(route, manifest, skHex) {
  const SK = hexToUint8Array(skHex);
  const content = JSON.stringify(manifest);
  const contentHash = computeHash(content);

  return finalizeEvent(
    {
      kind: EVENT_KINDS.MANIFEST,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["x", contentHash],
        ["route", route],
      ],
      content,
    },
    SK
  );
}

/**
 * Create site index event (kind 31126)
 *
 * @param {string} contentHash - Content hash for d tag
 * @param {Object} siteData - Site index data
 * @param {string} skHex - Private key in hex
 * @returns {Object} Finalized event
 */
export function createSiteIndexEvent(contentHash, siteData, skHex) {
  const SK = hexToUint8Array(skHex);
  const content = JSON.stringify(siteData);

  return finalizeEvent(
    {
      kind: EVENT_KINDS.SITE_INDEX,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["d", contentHash]],
      content,
    },
    SK
  );
}

/**
 * Create entrypoint event (kind 11126)
 *
 * @param {string} pubkey - Publisher public key
 * @param {string} contentHash - Site index d tag
 * @param {string} skHex - Private key in hex
 * @returns {Object} Finalized event
 */
export function createEntrypointEvent(pubkey, contentHash, skHex) {
  const SK = hexToUint8Array(skHex);

  return finalizeEvent(
    {
      kind: EVENT_KINDS.ENTRYPOINT,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["a", `${EVENT_KINDS.SITE_INDEX}:${pubkey}:${contentHash}`]],
      content: "",
    },
    SK
  );
}

/**
 * Create deletion event (kind 5)
 *
 * @param {Array<string>} eventIds - Event IDs to delete
 * @param {string} reason - Deletion reason
 * @param {string} skHex - Private key in hex
 * @returns {Object} Finalized event
 */
export function createDeletionEvent(eventIds, reason, skHex) {
  const SK = hexToUint8Array(skHex);

  return finalizeEvent(
    {
      kind: EVENT_KINDS.DELETION,
      created_at: Math.floor(Date.now() / 1000),
      tags: eventIds.map((id) => ["e", id]),
      content: reason,
    },
    SK
  );
}

/**
 * Compute SHA256 hash of content
 *
 * @param {string} content - Content to hash
 * @returns {string} Hex-encoded hash
 */
export function computeHash(content) {
  const hash = sha256(new TextEncoder().encode(content));
  return bytesToHex(hash);
}

/**
 * Extract event ID from event
 *
 * @param {Object} event - Nostr event
 * @returns {string} Event ID
 */
export function getEventId(event) {
  return event.id;
}

/**
 * Extract content hash from event tags
 *
 * @param {Object} event - Nostr event
 * @returns {string|null} Content hash or null
 */
export function getContentHash(event) {
  const xTag = event.tags.find((tag) => tag[0] === "x");
  return xTag ? xTag[1] : null;
}

/**
 * Extract d tag value from addressable event
 *
 * @param {Object} event - Nostr event
 * @returns {string|null} D tag value or null
 */
export function getDTag(event) {
  const dTag = event.tags.find((tag) => tag[0] === "d");
  return dTag ? dTag[1] : null;
}

/**
 * Extract route from manifest event
 *
 * @param {Object} event - Manifest event
 * @returns {string|null} Route or null
 */
export function getRoute(event) {
  const routeTag = event.tags.find((tag) => tag[0] === "route");
  return routeTag ? routeTag[1] : null;
}

/**
 * Extract event references from event
 *
 * @param {Object} event - Nostr event
 * @returns {Array<string>} Array of referenced event IDs
 */
export function getEventReferences(event) {
  return event.tags.filter((tag) => tag[0] === "e").map((tag) => tag[1]);
}

/**
 * Extract address reference from event
 *
 * @param {Object} event - Nostr event
 * @returns {string|null} Address reference or null
 */
export function getAddressReference(event) {
  const aTag = event.tags.find((tag) => tag[0] === "a");
  return aTag ? aTag[1] : null;
}

/**
 * Parse address reference
 *
 * @param {string} address - Address string (kind:pubkey:d-tag)
 * @returns {Object} Parsed address
 */
export function parseAddress(address) {
  const [kind, pubkey, dTag] = address.split(":");
  return {
    kind: parseInt(kind),
    pubkey,
    dTag,
  };
}

/**
 * Group events by kind
 *
 * @param {Array<Object>} events - Array of events
 * @returns {Map<number, Array<Object>>} Map of kind to events
 */
export function groupEventsByKind(events) {
  const grouped = new Map();

  for (const event of events) {
    if (!grouped.has(event.kind)) {
      grouped.set(event.kind, []);
    }
    grouped.get(event.kind).push(event);
  }

  return grouped;
}

/**
 * Filter events by kind
 *
 * @param {Array<Object>} events - Array of events
 * @param {number} kind - Event kind to filter
 * @returns {Array<Object>} Filtered events
 */
export function filterEventsByKind(events, kind) {
  return events.filter((event) => event.kind === kind);
}

/**
 * Sort events by created_at (newest first)
 *
 * @param {Array<Object>} events - Array of events
 * @returns {Array<Object>} Sorted events
 */
export function sortEventsByDate(events) {
  return [...events].sort((a, b) => b.created_at - a.created_at);
}

/**
 * Get latest event from array
 *
 * @param {Array<Object>} events - Array of events
 * @returns {Object|null} Latest event or null
 */
export function getLatestEvent(events) {
  if (events.length === 0) return null;
  return sortEventsByDate(events)[0];
}
