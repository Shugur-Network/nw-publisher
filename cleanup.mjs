#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { nip19, getPublicKey, Relay, finalizeEvent } from "nostr-tools";
import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";

dotenv.config();

const now = () => Math.floor(Date.now() / 1000);
const okHex64 = (s) => typeof s === "string" && /^[0-9a-f]{64}$/i.test(s);

/**
 * Get keypair from various sources
 * Priority: 1. NOSTR_SK_HEX env, 2. site dir keypair
 * Returns SK, pubkey, and npub
 */
function loadKeypair(siteDir = null) {
  // 1. Check environment variable first
  const envSK = process.env.NOSTR_SK_HEX;
  if (envSK && okHex64(envSK)) {
    const pubkey = getPublicKey(envSK);
    const npub = nip19.npubEncode(pubkey);
    return { SK: envSK, pubkey, npub };
  }

  // 2. Check for site directory keypair file
  if (siteDir) {
    const keypairPath = path.join(siteDir, ".nweb-keypair.json");
    if (fs.existsSync(keypairPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
        if (data.privateKey && okHex64(data.privateKey)) {
          const SK = data.privateKey;
          const pubkey = getPublicKey(SK);
          const npub = nip19.npubEncode(pubkey);
          return { SK, pubkey, npub };
        }
      } catch (e) {
        throw new Error(`Failed to read keypair file: ${e.message}`);
      }
    }
  }

  throw new Error(
    "No keypair found. Set NOSTR_SK_HEX in .env or provide a site directory with .nweb-keypair.json"
  );
}

/**
 * Read relays from environment
 */
function readRelays() {
  const relayStr = process.env.RELAYS || process.env.NOSTR_RELAYS;
  if (!relayStr) {
    throw new Error("RELAYS not found in .env file");
  }
  return relayStr.split(",").map((r) => r.trim());
}

/**
 * Connect to relays
 */
async function connectRelays(relays) {
  console.log(`\n🔌 Connecting to ${relays.length} relay(s)...`);
  const conns = [];

  for (const url of relays) {
    try {
      const relay = await Relay.connect(url);
      conns.push({ url, relay, connected: true });
      console.log(`   ✓ Connected to ${url}`);
    } catch (e) {
      console.warn(`   ✗ Failed to connect to ${url}: ${e.message}`);
      conns.push({ url, relay: null, connected: false });
    }
  }

  const connected = conns.filter((c) => c.connected).length;
  console.log(`   Connected to ${connected}/${relays.length} relay(s)\n`);

  if (connected === 0) {
    throw new Error("Failed to connect to any relays");
  }

  return conns;
}

/**
 * Sign an event
 */
function signEvent(SK, pubkey, unsignedEvent) {
  return finalizeEvent(unsignedEvent, SK);
}

/**
 * Query all events by pubkey for NIP-related kinds
 */
async function queryEventsFromRelay(relay, pubkey) {
  const kinds = [1125, 1126, 11126, 31126]; // All NIP-related event kinds

  return new Promise((resolve, reject) => {
    const events = [];
    const timeout = setTimeout(() => {
      sub.close();
      resolve(events);
    }, 10000); // 10 second timeout

    const sub = relay.subscribe(
      [
        {
          kinds: kinds,
          authors: [pubkey],
        },
      ],
      {
        onevent(event) {
          events.push(event);
        },
        oneose() {
          clearTimeout(timeout);
          sub.close();
          resolve(events);
        },
      }
    );
  });
}

/**
 * Delete events from relay
 */
async function deleteEventsFromRelay(relay, SK, pubkey, eventIds, reason) {
  if (eventIds.length === 0) return { deleted: 0, failed: 0 };

  let deleted = 0;
  let failed = 0;

  for (const eventId of eventIds) {
    try {
      const deleteEvent = signEvent(SK, pubkey, {
        kind: 5,
        created_at: now(),
        tags: [
          ["e", eventId],
          ["reason", reason],
        ],
        content: reason,
      });

      await relay.publish(deleteEvent);
      deleted++;
    } catch (e) {
      console.warn(
        `      ⚠️  Failed to delete ${eventId.substring(0, 8)}: ${e.message}`
      );
      failed++;
    }
  }

  return { deleted, failed };
}

/**
 * Main cleanup function
 */
async function main() {
  const [, , siteDirArg] = process.argv;

  const usage = `
Usage: node cleanup.mjs [site-folder]

This tool deletes ALL Nostr Web Pages events for your site.

Note: If no site-folder is provided, uses NOSTR_SK_HEX from .env

Examples:
  # Use .env private key (simplest)
  node cleanup.mjs
  
  # Use site directory keypair
  node cleanup.mjs examples/hello-world
`;

  console.log("🧹 Nostr Web Pages Cleanup Tool");
  console.log("=".repeat(70));
  console.log(
    "\nThis tool will delete ALL Nostr Web Pages events published by your site."
  );
  console.log(
    "Event kinds to be deleted: 1125 (Assets), 1126 (Manifests), 31126 (Site Index), 11126 (Entrypoint)"
  );
  console.log("\n⚠️  WARNING: This action cannot be undone!");
  console.log("⚠️  Deletion requests will be sent to all configured relays.");
  console.log("⚠️  Some relays may not honor deletion requests.\n");

  // Resolve site directory (if provided)
  let siteDir = null;
  if (siteDirArg) {
    siteDir = path.resolve(siteDirArg);
    if (!fs.existsSync(siteDir) || !fs.statSync(siteDir).isDirectory()) {
      throw new Error(`No such folder: ${siteDir}`);
    }
  }

  // Load keypair (from env or site directory)
  const { SK, pubkey, npub } = loadKeypair(siteDir);
  console.log(`Site Public Key: ${npub}\n`);

  // Load relays
  const relays = readRelays();
  console.log(`Configured relays: ${relays.join(", ")}\n`);

  // Confirm deletion
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question('Type "DELETE" to confirm cleanup: ');
  rl.close();

  if (answer.trim() !== "DELETE") {
    console.log("\n❌ Cleanup cancelled.");
    process.exit(0);
  }

  console.log("\n✓ Confirmed. Starting cleanup...\n");

  // Connect to relays
  const conns = await connectRelays(relays);
  const connectedRelays = conns.filter((c) => c.connected);

  // Step 1: Query all events from each relay
  console.log("🔍 Querying events from relays...");
  const relayEvents = {};
  let totalEventsFound = 0;

  for (const conn of connectedRelays) {
    console.log(`   Querying ${conn.url}...`);
    try {
      const events = await queryEventsFromRelay(conn.relay, pubkey);
      relayEvents[conn.url] = events;
      totalEventsFound += events.length;

      const kindCounts = {};
      events.forEach((e) => {
        kindCounts[e.kind] = (kindCounts[e.kind] || 0) + 1;
      });

      console.log(`      Found ${events.length} event(s):`);
      for (const [kind, count] of Object.entries(kindCounts)) {
        const kindName =
          kind === "1125"
            ? "Assets"
            : kind === "1126"
            ? "Manifests"
            : kind === "31126"
            ? "Site Index"
            : kind === "11126"
            ? "Entrypoint"
            : kind;
        console.log(`         - Kind ${kind} (${kindName}): ${count}`);
      }
    } catch (e) {
      console.warn(`      ✗ Query failed: ${e.message}`);
      relayEvents[conn.url] = [];
    }
  }

  console.log(
    `\n   Total events found across all relays: ${totalEventsFound}\n`
  );

  if (totalEventsFound === 0) {
    console.log("✅ No events found. Nothing to clean up.");
    process.exit(0);
  }

  // Step 2: Delete events from each relay
  console.log("🗑️  Deleting events from relays...\n");
  const deleteStats = {};

  for (const conn of connectedRelays) {
    const events = relayEvents[conn.url] || [];
    if (events.length === 0) {
      console.log(`   ✓ ${conn.url}: No events to delete`);
      deleteStats[conn.url] = { deleted: 0, failed: 0, total: 0 };
      continue;
    }

    console.log(`   🗑️  ${conn.url}: Deleting ${events.length} event(s)...`);
    const eventIds = events.map((e) => e.id);
    const result = await deleteEventsFromRelay(
      conn.relay,
      SK,
      pubkey,
      eventIds,
      "Manual cleanup via cleanup.mjs script"
    );

    deleteStats[conn.url] = { ...result, total: events.length };
    console.log(
      `      ✓ Deleted ${result.deleted}/${events.length} event(s)` +
        (result.failed > 0 ? `, ${result.failed} failed` : "")
    );
  }

  // Step 3: Delete cache file
  const cachePath = path.join(siteDir, ".nweb-cache.json");
  if (fs.existsSync(cachePath)) {
    fs.unlinkSync(cachePath);
    console.log(`\n🗑️  Deleted cache file: .nweb-cache.json`);
  }

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log("📊 CLEANUP SUMMARY");
  console.log("=".repeat(70) + "\n");

  let totalDeleted = 0;
  let totalFailed = 0;

  for (const [url, stats] of Object.entries(deleteStats)) {
    totalDeleted += stats.deleted;
    totalFailed += stats.failed;

    if (stats.total === 0) {
      console.log(`✓ ${url}: No events`);
    } else if (stats.failed === 0) {
      console.log(
        `✅ ${url}: ${stats.deleted}/${stats.total} deleted successfully`
      );
    } else {
      console.log(
        `⚠️  ${url}: ${stats.deleted}/${stats.total} deleted, ${stats.failed} failed`
      );
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log(
    `Total: ${totalDeleted} event(s) deleted` +
      (totalFailed > 0 ? `, ${totalFailed} failed` : "")
  );
  console.log("=".repeat(70) + "\n");

  console.log("✅ Cleanup complete!");
  console.log("\n📝 Notes:");
  console.log("   - Deletion requests have been sent to all relays");
  console.log("   - Some relays may not honor deletion requests immediately");
  console.log("   - Deleted events may still be cached by clients");
  if (siteDirArg) {
    console.log(
      "   - You can now republish your site with: node publish.mjs " +
        siteDirArg
    );
  } else {
    console.log(
      "   - You can now republish your site with: node publish.mjs <site-folder>"
    );
  }
  console.log("");

  // Close all relay connections
  for (const conn of connectedRelays) {
    try {
      conn.relay.close();
    } catch (e) {
      // Ignore close errors
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("\n❌ Error:", e.message);
  console.error(e.stack);
  process.exit(1);
});
