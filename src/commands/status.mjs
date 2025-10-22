#!/usr/bin/env node
/**
 * Status Command - Refactored Version
 *
 * Check relay connectivity, site status, and deployment health.
 */

import dotenv from "dotenv";

// Import refactored utilities
import { EVENT_KINDS } from "../lib/constants.mjs";
import { getPublicKeyFromPrivate } from "../lib/keypair.mjs";
import {
  connectToRelay,
  closeRelay,
  testRelayConnectivity,
  parseRelayUrls,
} from "../lib/relay.mjs";
import { logger } from "../utils/logger.mjs";
import { handleError, ConfigError, ValidationError } from "../utils/errors.mjs";
import { nip19 } from "nostr-tools";

// Load .env from current working directory
dotenv.config({ path: process.cwd() + '/.env' });

/**
 * Get public key from CLI argument or environment
 * Read-only command - only accepts npub/hex, not site directory
 *
 * @param {string} pubkeyArg - CLI argument (npub or hex only)
 * @returns {Object} { pubkey, npub }
 */
function getPublicKey(pubkeyArg = null) {
  try {
    // 1. Try from CLI argument (npub or hex)
    if (pubkeyArg) {
      // Check if it's an npub
      if (pubkeyArg.startsWith("npub1")) {
        try {
          const { data } = nip19.decode(pubkeyArg);
          return { pubkey: data, npub: pubkeyArg };
        } catch (error) {
          throw new ValidationError(`Invalid npub: ${error.message}`);
        }
      }

      // Check if it's hex format (64 characters)
      if (/^[0-9a-f]{64}$/i.test(pubkeyArg)) {
        const npub = nip19.npubEncode(pubkeyArg);
        return { pubkey: pubkeyArg, npub };
      }

      throw new ValidationError(
        "Invalid argument. Provide npub1... or 64-char hex pubkey"
      );
    }

    // 2. Try from environment (NOSTR_SK_HEX from .env or system env)
    if (process.env.NOSTR_SK_HEX) {
      const pubkey = getPublicKeyFromPrivate(process.env.NOSTR_SK_HEX);
      return { pubkey, npub: nip19.npubEncode(pubkey) };
    }

    throw new ConfigError(
      "No pubkey found. Provide npub/hex as argument or set NOSTR_SK_HEX in .env"
    );
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ConfigError) {
      throw error;
    }
    throw new ConfigError("Failed to load public key: " + error.message);
  }
}

/**
 * Query event count from relay
 */
async function queryEventCount(relay, pubkey) {
  try {
    const kinds = [
      EVENT_KINDS.ASSET,
      EVENT_KINDS.MANIFEST,
      EVENT_KINDS.SITE_INDEX,
      EVENT_KINDS.ENTRYPOINT,
    ];

    const events = await new Promise((resolve, reject) => {
      const found = [];
      const timeout = setTimeout(() => {
        sub.close();
        resolve(found);
      }, 5000);

      const sub = relay.subscribe([{ kinds, authors: [pubkey], limit: 100 }], {
        onevent(event) {
          found.push(event);
        },
        oneose() {
          clearTimeout(timeout);
          sub.close();
          resolve(found);
        },
      });
    });

    return events.length;
  } catch (error) {
    logger.debug(`Query failed: ${error.message}`);
    return 0;
  }
}

/**
 * Check DNS configuration
 */
async function checkDns(domain) {
  try {
    const { resolve } = await import("node:dns/promises");
    const txtRecords = await resolve(`_nweb.${domain}`, "TXT");

    if (txtRecords && txtRecords.length > 0) {
      const record = txtRecords[0].join("");
      try {
        const data = JSON.parse(record);
        return { configured: true, record: data, error: null };
      } catch {
        return {
          configured: true,
          record: null,
          error: "Invalid JSON in TXT record",
        };
      }
    }

    return { configured: false, record: null, error: "No TXT record found" };
  } catch (error) {
    return { configured: false, record: null, error: error.message };
  }
}

/**
 * Main status check function
 */
async function checkStatus(pubkeyArg = null) {
  try {
    // Display header
    logger.header("📊 Nostr Web Status Check");

    // Get public key
    const { pubkey, npub } = getPublicKey(pubkeyArg);
    logger.info(`🔑 Identity: ${npub}\n`);

    // Check relay connectivity
    const relayList = process.env.RELAYS || process.env.NOSTR_RELAYS;
    if (!relayList) {
      throw new ConfigError("RELAYS not configured in .env");
    }
    const relays = parseRelayUrls(relayList);

    logger.info("🔌 Relay Connectivity:\n");

    const relayResults = await Promise.all(
      relays.map((url) => testRelayConnectivity(url))
    );

    for (const result of relayResults) {
      if (result.connected) {
        logger.success(`   ${result.url}: ✓ ${result.latency}ms`);
      } else {
        logger.error(`   ${result.url}: ✗ ${result.error}`);
      }
    }

    const onlineCount = relayResults.filter((r) => r.connected).length;
    logger.info(`\n   ${onlineCount}/${relays.length} relays online\n`);

    // Query events from online relays
    if (onlineCount > 0) {
      logger.info("📦 Published Events:\n");

      for (const result of relayResults) {
        if (result.connected) {
          try {
            const relay = await connectToRelay(result.url);
            const count = await queryEventCount(relay, pubkey);
            logger.info(`   ${result.url}: ${count} events`);
            closeRelay(relay);
          } catch (error) {
            logger.warn(`   ${result.url}: query failed`);
          }
        }
      }
    }

    // DNS check
    const domain = process.env.NWEB_HOST;
    if (domain) {
      logger.info("\n🌐 DNS Configuration:\n");
      const dnsResult = await checkDns(domain);

      if (dnsResult.configured && dnsResult.record) {
        logger.success(`   ✓ TXT record found for _nweb.${domain}`);
        logger.info(`   Pubkey: ${dnsResult.record.pk || "not set"}`);
        logger.info(`   Relays: ${dnsResult.record.relays?.length || 0}`);
      } else if (dnsResult.configured && !dnsResult.record) {
        logger.warn(`   ⚠️  TXT record found but invalid: ${dnsResult.error}`);
      } else {
        logger.error(`   ✗ No TXT record found for _nweb.${domain}`);
        logger.info(`   Run 'nw-publisher deploy' to generate DNS instructions`);
      }
    }

    // Overall status
    logger.info("");
    logger.separator();

    if (onlineCount === relays.length) {
      logger.success("\n✅ All systems operational!\n");
    } else if (onlineCount > 0) {
      logger.warn(`\n⚠️  ${relays.length - onlineCount} relay(s) offline\n`);
    } else {
      logger.error("\n❌ All relays offline!\n");
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
📊 Nostr Web Status Check

Check relay connectivity and deployment status for any Nostr site.

Usage: nw-publisher status [npub|hex]

Arguments:
  npub              Query status by npub (e.g., npub1...)
  hex               Query status by hex pubkey (64 characters)

Examples:
  # Use .env configuration
  nw-publisher status
  
  # Query any site by npub (no private key needed!)
  nw-publisher status npub1abc123...
  
  # Query by hex pubkey
  nw-publisher status a1b2c3d4e5f6...

What it checks:
  - Relay connectivity and latency
  - Published events count per relay
  - DNS configuration (_nweb TXT record)
`);
    return;
  }

  const pubkeyArg = args[0] || null;

  await checkStatus(pubkeyArg);

  // Explicitly exit to prevent hanging connections
  process.exit(0);
}

// Run with error handling
main().catch((error) => {
  handleError(error);
  process.exit(1);
});
