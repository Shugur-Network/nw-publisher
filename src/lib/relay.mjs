/**
 * Relay Utilities
 *
 * Shared functionality for connecting to and interacting with Nostr relays.
 */

import { Relay } from "nostr-tools";
import { NETWORK, EXIT_CODES } from "./constants.mjs";
import { logger } from "../utils/logger.mjs";

/**
 * Connect to a relay with timeout and error handling
 *
 * @param {string} url - Relay URL
 * @param {number} timeout - Connection timeout in ms
 * @returns {Promise<Relay>} Connected relay instance
 * @throws {Error} If connection fails
 */
export async function connectToRelay(url, timeout = NETWORK.RELAY_TIMEOUT) {
  const relay = await Promise.race([
    Relay.connect(url),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Connection timeout")), timeout)
    ),
  ]);

  return relay;
}

/**
 * Safely close a relay connection
 *
 * @param {Relay} relay - Relay instance to close
 */
export function closeRelay(relay) {
  try {
    relay?.close();
  } catch (error) {
    logger.debug(`Error closing relay: ${error.message}`);
  }
}

/**
 * Query events from a relay with timeout
 *
 * @param {Relay} relay - Connected relay instance
 * @param {Array} filters - Nostr filters
 * @param {number} timeout - Query timeout in ms
 * @returns {Promise<Array>} Array of events
 */
export async function queryEvents(
  relay,
  filters,
  timeout = NETWORK.RELAY_TIMEOUT
) {
  const events = [];

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      sub.close();
      resolve(events);
    }, timeout);

    const sub = relay.subscribe(filters, {
      onevent(event) {
        events.push(event);
      },
      oneose() {
        clearTimeout(timeoutId);
        sub.close();
        resolve(events);
      },
    });
  });
}

/**
 * Publish an event to a relay with retry logic
 *
 * @param {Relay} relay - Connected relay instance
 * @param {Object} event - Finalized event to publish
 * @param {number} retries - Number of retry attempts
 * @returns {Promise<void>}
 */
export async function publishEvent(
  relay,
  event,
  retries = NETWORK.MAX_RETRIES
) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await Promise.race([
        relay.publish(event),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Publish timeout")),
            NETWORK.PUBLISH_TIMEOUT
          )
        ),
      ]);
      return; // Success
    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        const delay =
          NETWORK.RETRY_DELAY * Math.pow(NETWORK.BACKOFF_MULTIPLIER, attempt);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * Parse relay URLs from environment or config
 *
 * @param {string|Array} relays - Comma-separated string or array
 * @returns {Array<string>} Array of relay URLs
 */
export function parseRelayUrls(relays) {
  if (Array.isArray(relays)) {
    return relays;
  }

  if (typeof relays === "string") {
    return relays
      .split(",")
      .map((url) => url.trim())
      .filter((url) => url.startsWith("wss://") || url.startsWith("ws://"));
  }

  return [];
}

/**
 * Validate relay URL
 *
 * @param {string} url - Relay URL to validate
 * @returns {boolean} True if valid
 */
export function isValidRelayUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "wss:" || parsed.protocol === "ws:";
  } catch {
    return false;
  }
}

/**
 * Sleep utility
 *
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Test relay connectivity
 *
 * @param {string} url - Relay URL
 * @returns {Promise<Object>} Connection test result
 */
export async function testRelayConnectivity(url) {
  const startTime = Date.now();

  try {
    const relay = await connectToRelay(url, 5000);
    const latency = Date.now() - startTime;
    closeRelay(relay);

    return {
      url,
      connected: true,
      latency,
      error: null,
    };
  } catch (error) {
    return {
      url,
      connected: false,
      latency: null,
      error: error.message,
    };
  }
}

/**
 * Query events from multiple relays in parallel
 *
 * @param {Array<string>} relayUrls - Array of relay URLs
 * @param {Array} filters - Nostr filters
 * @param {string} pubkey - Author pubkey for filtering
 * @returns {Promise<Map>} Map of relay URL to events array
 */
export async function queryMultipleRelays(relayUrls, filters, pubkey) {
  const results = new Map();

  const promises = relayUrls.map(async (url) => {
    try {
      const relay = await connectToRelay(url);
      const events = await queryEvents(relay, [
        { ...filters[0], authors: [pubkey] },
      ]);
      closeRelay(relay);
      results.set(url, events);
    } catch (error) {
      logger.debug(`Failed to query ${url}: ${error.message}`);
      results.set(url, []);
    }
  });

  await Promise.allSettled(promises);
  return results;
}

/**
 * Publish event to multiple relays with rollback on failure
 *
 * @param {Array<string>} relayUrls - Array of relay URLs
 * @param {Object} event - Event to publish
 * @returns {Promise<Object>} Results with successful and failed relays
 */
export async function publishToMultipleRelays(relayUrls, event) {
  const results = {
    successful: [],
    failed: [],
  };

  for (const url of relayUrls) {
    try {
      const relay = await connectToRelay(url);
      await publishEvent(relay, event);
      closeRelay(relay);
      results.successful.push(url);
    } catch (error) {
      logger.debug(`Failed to publish to ${url}: ${error.message}`);
      results.failed.push({ url, error: error.message });
    }
  }

  return results;
}
