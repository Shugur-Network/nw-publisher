#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { Relay, nip19, getPublicKey } from "nostr-tools";

dotenv.config();

const okHex64 = (s) => typeof s === "string" && /^[0-9a-f]{64}$/i.test(s);

/**
 * Get pubkey from various sources
 * Priority: 1. CLI argument (npub/hex), 2. NOSTR_SK_HEX env, 3. site dir keypair
 */
function getPubkey(pubkeyArg, siteDir = null) {
  // 1. Try from CLI argument
  if (pubkeyArg) {
    // Try as npub
    if (pubkeyArg.startsWith("npub1")) {
      try {
        const { data } = nip19.decode(pubkeyArg);
        return { pubkey: data, npub: pubkeyArg };
      } catch (e) {
        throw new Error(`Invalid npub: ${e.message}`);
      }
    }

    // Try as hex
    if (okHex64(pubkeyArg)) {
      const npub = nip19.npubEncode(pubkeyArg);
      return { pubkey: pubkeyArg, npub };
    }

    throw new Error(`Invalid pubkey format. Use npub1... or 64-char hex`);
  }

  // 2. Try from environment
  const envSK = process.env.NOSTR_SK_HEX;
  if (envSK && okHex64(envSK)) {
    const pubkey = getPublicKey(envSK);
    const npub = nip19.npubEncode(pubkey);
    return { pubkey, npub };
  }

  // 3. Try from site directory
  if (siteDir) {
    const keypairPath = path.join(siteDir, ".nweb-keypair.json");
    if (fs.existsSync(keypairPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
        if (data.privateKey && okHex64(data.privateKey)) {
          const pubkey = getPublicKey(data.privateKey);
          const npub = nip19.npubEncode(pubkey);
          return { pubkey, npub };
        }
      } catch (e) {
        throw new Error(`Failed to read keypair file: ${e.message}`);
      }
    }
  }

  throw new Error(
    "No pubkey found. Provide npub/hex as argument, set NOSTR_SK_HEX, or run from site directory with .nweb-keypair.json"
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
 * Connect to a relay
 */
async function connectRelay(url) {
  try {
    const relay = await Relay.connect(url);
    return relay;
  } catch (e) {
    throw new Error(`Failed to connect to ${url}: ${e.message}`);
  }
}

/**
 * Query all site index events from relay
 */
async function queryAllSiteIndexes(relay, pubkey) {
  return new Promise((resolve, reject) => {
    const events = [];
    const timeout = setTimeout(() => {
      sub.close();
      resolve(events);
    }, 10000);

    const sub = relay.subscribe(
      [
        {
          kinds: [31126], // Site Index events
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
 * Query entrypoint events from relay
 */
async function queryEntrypoints(relay, pubkey) {
  return new Promise((resolve, reject) => {
    const events = [];
    const timeout = setTimeout(() => {
      sub.close();
      resolve(events);
    }, 10000);

    const sub = relay.subscribe(
      [
        {
          kinds: [11126], // Entrypoint events
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
 * Build version history from relay events
 */
function buildVersionHistory(siteIndexEvents, entrypointEvents) {
  // Sort site indexes by creation time (oldest first)
  const sortedIndexes = siteIndexEvents.sort(
    (a, b) => a.created_at - b.created_at
  );

  const versions = sortedIndexes.map((event, index) => {
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
      siteIndexId: event.id,
      entrypointId: entrypoint?.id || null,
      contentHash: dTag,
      fullHash: xTag,
      timestamp: new Date(event.created_at * 1000).toISOString(),
      created_at: event.created_at,
      routes: Object.keys(content.routes || {}),
      defaultRoute: content.defaultRoute,
      notFoundRoute: content.notFoundRoute,
      routeManifests: content.routes || {},
    };
  });

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
  const relays = readRelays();

  console.log(`\n🔍 Fetching version history from relays...`);
  console.log(`   Site: ${npub}\n`);

  let allSiteIndexes = [];
  let allEntrypoints = [];

  for (const relayUrl of relays) {
    try {
      console.log(`   Connecting to ${relayUrl}...`);
      const relay = await connectRelay(relayUrl);

      const siteIndexes = await queryAllSiteIndexes(relay, pubkey);
      const entrypoints = await queryEntrypoints(relay, pubkey);

      console.log(
        `      Found ${siteIndexes.length} site index(es), ${entrypoints.length} entrypoint(s)`
      );

      // Merge events (deduplicate by ID)
      for (const event of siteIndexes) {
        if (!allSiteIndexes.find((e) => e.id === event.id)) {
          allSiteIndexes.push(event);
        }
      }

      for (const event of entrypoints) {
        if (!allEntrypoints.find((e) => e.id === event.id)) {
          allEntrypoints.push(event);
        }
      }

      relay.close();
    } catch (e) {
      console.log(`      ✗ ${e.message}`);
    }
  }

  console.log(
    `\n   Total unique: ${allSiteIndexes.length} site index(es), ${allEntrypoints.length} entrypoint(s)\n`
  );

  if (allSiteIndexes.length === 0) {
    throw new Error(
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

  console.log("📚 Version History");
  console.log("=".repeat(70));
  console.log(`Current Version: ${history.current}\n`);

  if (history.versions.length === 0) {
    console.log("No versions available.\n");
    return;
  }

  console.log(`Total Versions: ${history.versions.length}\n`);

  // Display versions in reverse chronological order (newest first)
  const versions = [...history.versions].reverse();

  for (let i = 0; i < versions.length; i++) {
    const v = versions[i];
    const isCurrent = i === 0; // Most recent is current
    const marker = isCurrent ? "→ " : "  ";

    console.log(`${marker}v${v.version} ${isCurrent ? "(current)" : ""}`);
    console.log(`  Date: ${new Date(v.timestamp).toLocaleString()}`);
    console.log(`  Hash: ${v.contentHash}`);
    console.log(`  Site Index: ${v.siteIndexId.substring(0, 16)}...`);
    if (v.entrypointId) {
      console.log(`  Entrypoint: ${v.entrypointId.substring(0, 16)}...`);
    }
    console.log(`  Routes (${v.routes.length}): ${v.routes.join(", ")}`);

    if (i < versions.length - 1) {
      console.log("");
    }
  }

  console.log("\n" + "=".repeat(70) + "\n");
}

/**
 * Show version details
 */
async function showVersion(pubkey, npub, version) {
  const history = await fetchVersionHistory(pubkey, npub);

  const versionEntry = history.versions.find((v) => v.version === version);

  if (!versionEntry) {
    console.error(`❌ Version ${version} not found`);
    console.log("\nAvailable versions:");
    history.versions.forEach((v) => console.log(`  - ${v.version}`));
    process.exit(1);
  }

  console.log("\n📖 Version Details");
  console.log("=".repeat(70));
  console.log(`Version: ${versionEntry.version}`);
  console.log(`Date: ${new Date(versionEntry.timestamp).toLocaleString()}`);
  console.log(`Content Hash: ${versionEntry.contentHash}`);
  console.log(`Full Hash: ${versionEntry.fullHash}`);
  console.log(`Site Index ID: ${versionEntry.siteIndexId}`);
  if (versionEntry.entrypointId) {
    console.log(`Entrypoint ID: ${versionEntry.entrypointId}`);
  }
  console.log(`Default Route: ${versionEntry.defaultRoute}`);
  if (versionEntry.notFoundRoute) {
    console.log(`404 Route: ${versionEntry.notFoundRoute}`);
  }
  console.log(`\nRoutes (${versionEntry.routes.length}):`);

  for (const route of versionEntry.routes) {
    const manifestId = versionEntry.routeManifests[route];
    console.log(`  ${route} → ${manifestId.substring(0, 16)}...`);
  }

  console.log("\n" + "=".repeat(70) + "\n");
}

/**
 * Compare two versions
 */
async function compareVersions(pubkey, npub, version1, version2) {
  const history = await fetchVersionHistory(pubkey, npub);

  const v1 = history.versions.find((v) => v.version === version1);
  const v2 = history.versions.find((v) => v.version === version2);

  if (!v1 || !v2) {
    console.error(`❌ Version not found`);
    if (!v1) console.log(`   ${version1} not found`);
    if (!v2) console.log(`   ${version2} not found`);
    process.exit(1);
  }

  console.log("\n🔍 Version Comparison");
  console.log("=".repeat(70));
  console.log(
    `${version1} (${new Date(
      v1.timestamp
    ).toLocaleDateString()}) ↔️ ${version2} (${new Date(
      v2.timestamp
    ).toLocaleDateString()})`
  );
  console.log("=".repeat(70) + "\n");

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
    console.log(`✅ Routes Added (${added.length}):`);
    added.forEach((r) => {
      const manifestId = v2.routeManifests[r];
      console.log(`   + ${r} (${manifestId.substring(0, 8)}...)`);
    });
    console.log("");
  }

  if (removed.length > 0) {
    console.log(`❌ Routes Removed (${removed.length}):`);
    removed.forEach((r) => {
      const manifestId = v1.routeManifests[r];
      console.log(`   - ${r} (${manifestId.substring(0, 8)}...)`);
    });
    console.log("");
  }

  if (modified.length > 0) {
    console.log(`🔄 Routes Modified (${modified.length}):`);
    modified.forEach((r) => {
      const oldManifest = v1.routeManifests[r].substring(0, 8);
      const newManifest = v2.routeManifests[r].substring(0, 8);
      console.log(`   ≈ ${r}`);
      console.log(`     ${oldManifest}... → ${newManifest}...`);
    });
    console.log("");
  }

  const trulyUnchanged = unchanged.filter((r) => !modified.includes(r));

  if (trulyUnchanged.length > 0) {
    console.log(`   Routes Unchanged (${trulyUnchanged.length}):`);
    trulyUnchanged.forEach((r) => console.log(`     ${r}`));
    console.log("");
  }

  // Summary
  console.log("Summary:");
  console.log(`  Total routes in ${version1}: ${routes1.size}`);
  console.log(`  Total routes in ${version2}: ${routes2.size}`);
  console.log(`  Added: ${added.length}`);
  console.log(`  Removed: ${removed.length}`);
  console.log(`  Modified: ${modified.length}`);
  console.log(`  Unchanged: ${trulyUnchanged.length}`);
  console.log(
    `  Time elapsed: ${Math.abs(v2.created_at - v1.created_at)} seconds`
  );
  console.log("\n" + "=".repeat(70) + "\n");
}

/**
 * Main function
 */
async function main() {
  const [, , command, pubkeyOrSiteArg, ...args] = process.argv;

  const usage = `
Usage: node versions.mjs <command> [npub|hex|site-folder] [options]

Commands:
  list                        List all versions from relays
  show <version>              Show details for a specific version
  compare <version1> <version2>  Compare two versions
  current                     Show current version

Note: If no npub/hex/site-folder is provided, uses NOSTR_SK_HEX from .env

Examples:
  # Use .env private key (simplest)
  node versions.mjs list
  node versions.mjs show 0.2.0
  node versions.mjs compare 0.1.0 0.2.0
  node versions.mjs current
  
  # Query by npub (doesn't require local site files)
  node versions.mjs list npub1...
  node versions.mjs show npub1... 0.2.0
  node versions.mjs compare npub1... 0.1.0 0.2.0
  node versions.mjs current npub1...
  
  # Query by hex pubkey
  node versions.mjs list a1b2c3d4...
  
  # Query by site directory (for convenience)
  node versions.mjs list examples/hello-world
  node versions.mjs show examples/hello-world 0.2.0
  node versions.mjs compare examples/hello-world 0.1.0 0.2.0
  node versions.mjs current examples/hello-world
`;

  if (!command) {
    console.log(usage);
    process.exit(1);
  }

  // Detect if the second argument is a directory, pubkey, or missing (use env)
  let pubkey, npub, siteDir;
  let identifierProvided = false;

  if (!pubkeyOrSiteArg) {
    // No argument provided - use environment variable
    const result = await getPubkey(null, null);
    pubkey = result.pubkey;
    npub = result.npub;
  } else if (pubkeyOrSiteArg.startsWith("npub1")) {
    // It's an npub
    identifierProvided = true;
    npub = pubkeyOrSiteArg;
    const decoded = nip19.decode(npub);
    pubkey = decoded.data;
  } else if (
    pubkeyOrSiteArg.length === 64 &&
    /^[0-9a-f]+$/i.test(pubkeyOrSiteArg)
  ) {
    // It's a hex pubkey
    identifierProvided = true;
    pubkey = pubkeyOrSiteArg.toLowerCase();
    npub = nip19.npubEncode(pubkey);
  } else {
    // Check if it's a valid directory
    const potentialDir = path.resolve(pubkeyOrSiteArg);
    if (
      fs.existsSync(potentialDir) &&
      fs.statSync(potentialDir).isDirectory()
    ) {
      // It's a site directory
      identifierProvided = true;
      siteDir = potentialDir;
      const result = await getPubkey(null, siteDir);
      pubkey = result.pubkey;
      npub = result.npub;
    } else {
      // Not a valid directory, npub, or hex - assume it's a version/command arg
      // Use environment variable for pubkey
      const result = await getPubkey(null, null);
      pubkey = result.pubkey;
      npub = result.npub;
    }
  }

  // Adjust args based on whether an identifier was provided
  const commandArgs = identifierProvided
    ? args
    : [pubkeyOrSiteArg, ...args].filter(Boolean);

  switch (command) {
    case "list":
      await listVersions(pubkey, npub);
      break;

    case "show":
      if (commandArgs.length === 0) {
        console.error("❌ Please specify a version");
        console.log(
          "Usage: node versions.mjs show [npub|hex|site-folder] <version>"
        );
        process.exit(1);
      }
      await showVersion(pubkey, npub, commandArgs[0]);
      break;

    case "compare":
      if (commandArgs.length < 2) {
        console.error("❌ Please specify two versions to compare");
        console.log(
          "Usage: node versions.mjs compare [npub|hex|site-folder] <version1> <version2>"
        );
        process.exit(1);
      }
      await compareVersions(pubkey, npub, commandArgs[0], commandArgs[1]);
      break;

    case "current":
      const history = await fetchVersionHistory(pubkey, npub);
      console.log(`\nCurrent version: ${history.current}\n`);
      break;

    default:
      console.error(`❌ Unknown command: ${command}`);
      console.log(usage);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error("\n❌ Error:", e.message);
  process.exit(1);
});
