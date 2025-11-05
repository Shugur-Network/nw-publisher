#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { fetch } from "undici";
import mime from "mime";
import {
  nip19,
  getEventHash,
  finalizeEvent,
  Relay,
  getPublicKey,
  generateSecretKey,
} from "nostr-tools";
import {
  rebuildCacheFromRelays,
  queryVersionHistory,
} from "../lib/relay-query.mjs";
import { parseRelayUrls } from "../lib/relay.mjs";

// Load .env from current working directory
dotenv.config({ path: process.cwd() + "/.env" });

const now = () => Math.floor(Date.now() / 1000);
const sha256Hex = (buf) =>
  crypto.createHash("sha256").update(buf).digest("hex");
const okHex64 = (s) => typeof s === "string" && /^[0-9a-f]{64}$/i.test(s);

/**
 * Load or generate keypair for the site
 * Priority: 1) NOSTR_SK_HEX env var, 2) .nweb-keypair.json in site dir, 3) Generate new
 */
function loadOrGenerateKeypair(siteDir) {
  const keypairPath = path.join(siteDir, ".nweb-keypair.json");

  // 1. Check environment variable first (for CI/CD or manual override)
  const envSK = process.env.NOSTR_SK_HEX;
  if (envSK && okHex64(envSK)) {
    console.log("✓ Using keypair from NOSTR_SK_HEX environment variable");
    const pubkey = getPublicKey(envSK);
    const npub = nip19.npubEncode(pubkey);
    return { SK: envSK, pubkey, npub, source: "env" };
  }

  // 2. Check for existing keypair file
  if (fs.existsSync(keypairPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
      if (data.privateKey && okHex64(data.privateKey)) {
        console.log(`✓ Using existing keypair from .nweb-keypair.json`);
        const SK = data.privateKey;
        const pubkey = getPublicKey(SK);
        const npub = nip19.npubEncode(pubkey);
        const nsec = nip19.nsecEncode(SK);

        console.log(`  Public Key (npub): ${npub}`);
        console.log(`  Private Key (nsec): ${nsec}`);

        return { SK, pubkey, npub, source: "file" };
      }
    } catch (e) {
      console.warn(`⚠ Failed to read keypair file: ${e.message}`);
    }
  }

  // 3. Generate new keypair
  console.log("🔑 No keypair found. Generating new keypair...");
  const secretKeyBytes = generateSecretKey();
  const SK = Buffer.from(secretKeyBytes).toString("hex");
  const pubkey = getPublicKey(SK);
  const npub = nip19.npubEncode(pubkey);
  const nsec = nip19.nsecEncode(SK);

  // Save keypair to file
  const keypairData = {
    privateKey: SK,
    publicKey: pubkey,
    npub: npub,
    nsec: nsec,
    createdAt: new Date().toISOString(),
    note: "Keep this file secure! Anyone with the private key can publish to your site.",
  };

  fs.writeFileSync(keypairPath, JSON.stringify(keypairData, null, 2));
  console.log(`✓ New keypair saved to .nweb-keypair.json`);
  console.log(`\n⚠️  Important: Secure your private key`);
  console.log(`   Anyone with access to this key can publish content as you.`);
  console.log(`\n  Public Key (npub):  ${npub}`);
  console.log(`  Private Key (nsec): ${nsec}`);
  console.log(`\n  Keypair Storage Options:`);
  console.log(
    `   • Keep the .nweb-keypair.json file in your site directory, or`
  );
  console.log(`   • Set NOSTR_SK_HEX=${SK} in your .env file\n`);

  return { SK, pubkey, npub, source: "generated" };
}

function readEnv() {
  const relays = (process.env.RELAYS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!relays.length) throw new Error("RELAYS is required (comma-separated)");
  const host = (process.env.NWEB_HOST || "").trim();
  return { relays, host };
}

/**
 * Load cached event mappings (content hash -> event ID)
 * Always queries relays - no local cache file used
 *
 * @param {string} siteDir - Site directory path (unused, kept for compatibility)
 * @param {Array} relays - Array of relay URLs
 * @param {string} pubkey - Public key
 * @param {boolean} forceRebuild - Unused, kept for compatibility
 * @returns {Promise<Object>} Cache object built from relay data
 */
async function loadEventCache(
  siteDir,
  relays = null,
  pubkey = null,
  forceRebuild = false
) {
  // Always query relays - no local cache file
  if (relays && relays.length > 0 && pubkey) {
    console.log("📡 Querying Nostr relays for existing events...\n");
    try {
      const cache = await rebuildCacheFromRelays(relays, pubkey);
      return cache;
    } catch (e) {
      console.warn(`⚠ Failed to query relays: ${e.message}`);
    }
  }

  // Default: Empty cache if no relay connection
  console.log("📦 Starting with empty cache (no relays available)\n");
  return {
    assets: {},
    manifests: {},
    siteIndex: null,
    version: { major: 0, minor: 0, patch: 0 },
    versionHistory: [],
  };
}

/**
 * Load version history
 * Always queries relays - no local cache file used
 *
 * @param {string} siteDir - Site directory path (unused, kept for compatibility)
 * @param {Array} relays - Array of relay URLs
 * @param {string} pubkey - Public key
 * @param {boolean} forceRebuild - Unused, kept for compatibility
 * @returns {Promise<Object>} Version history object built from relay data
 */
async function loadVersionHistory(
  siteDir,
  relays = null,
  pubkey = null,
  forceRebuild = false
) {
  // Always query relays - no local version file
  if (relays && relays.length > 0 && pubkey) {
    console.log("📡 Querying Nostr relays for version history...\n");
    try {
      const history = await queryVersionHistory(relays, pubkey);
      return history;
    } catch (e) {
      console.warn(
        `⚠ Failed to query version history from relays: ${e.message}`
      );
    }
  }

  // Default: Empty history if no relay connection
  console.log("📜 Starting with empty version history (no relays available)\n");
  return {
    current: "0.1.0",
    versions: [],
  };
}

/**
 * Save version history (DISABLED - we rely 100% on relay data)
 */
function saveVersionHistory(siteDir, history) {
  // No-op: We no longer save version history locally
  // Always query relays for the source of truth
}

/**
 * Parse and validate semantic version string
 * @param {string} versionStr - Version string in format X.Y.Z
 * @returns {string|null} - Valid version string or null if invalid
 */
function parseVersion(versionStr) {
  if (!versionStr || typeof versionStr !== "string") {
    return null;
  }

  const parts = versionStr.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [major, minor, patch] = parts;

  // Check if all parts are valid numbers
  if (!/^\d+$/.test(major) || !/^\d+$/.test(minor) || !/^\d+$/.test(patch)) {
    return null;
  }

  // Return normalized version
  return `${parseInt(major)}.${parseInt(minor)}.${parseInt(patch)}`;
}

/**
 * Increment version based on change type
 */
function incrementVersion(currentVersion, changeType = "patch") {
  const [major, minor, patch] = currentVersion.split(".").map(Number);

  switch (changeType) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
}

/**
 * Determine version change type based on what changed
 */
function detectChangeType(cache, newManifests, newSiteIndexContent) {
  // Major: Routes added/removed (breaking change)
  // Minor: New assets/manifests (new features)
  // Patch: Asset content changed (bug fixes)

  const oldRoutes = cache.siteIndex?.routes || {};
  const newRoutes = JSON.parse(newSiteIndexContent).routes;

  const oldRouteKeys = Object.keys(oldRoutes).sort();
  const newRouteKeys = Object.keys(newRoutes).sort();

  // Check if routes changed
  if (JSON.stringify(oldRouteKeys) !== JSON.stringify(newRouteKeys)) {
    return "minor"; // Routes added/removed = new feature
  }

  // Check if manifests changed (new assets)
  const manifestChanged = newManifests.some((m) => {
    const route = m.tags?.find((t) => t[0] === "route")?.[1] || "/";
    const cachedManifest = cache.manifests[route];
    return !cachedManifest || cachedManifest.id !== m.id;
  });

  if (manifestChanged) {
    return "patch"; // Content changed = bug fix/update
  }

  return "patch"; // Default to patch
}

/**
 * Save event cache to disk (DISABLED - we rely 100% on relay data)
 */
function saveEventCache(siteDir, cache) {
  // No-op: We no longer save cache files locally
  // Always query relays for the source of truth
}

/**
 * Check if directory should be ignored during scanning
 */
function shouldIgnoreDir(name) {
  return (
    name.startsWith(".") ||
    name === "node_modules" ||
    name === "dist" ||
    name === "build" ||
    name === "out" ||
    name === "_site"
  );
}

/**
 * Recursively find all HTML files in directory
 * Returns array of { path: string, route: string }
 */
function findHTMLFiles(dir, baseDir = dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!shouldIgnoreDir(entry.name)) {
        files.push(...findHTMLFiles(fullPath, baseDir));
      }
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      const relativePath = path.relative(baseDir, fullPath);
      const route = htmlPathToRoute(relativePath);
      files.push({ path: fullPath, route });
    }
  }

  return files;
}

/**
 * Convert HTML file path to route
 * Examples:
 *   index.html → /
 *   about.html → /about
 *   blog/index.html → /blog
 *   blog/post-1.html → /blog/post-1
 *   docs/api/intro.html → /docs/api/intro
 */
function htmlPathToRoute(htmlPath) {
  // Normalize path separators
  let route = "/" + htmlPath.replace(/\\/g, "/");

  // Strip trailing /index.html to get directory route
  route = route.replace(/\/index\.html$/, "") || "/";

  // Strip .html extension
  route = route.replace(/\.html$/, "");

  return route;
}

async function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    // Skip ignored directories
    if (e.isDirectory() && shouldIgnoreDir(e.name)) {
      continue;
    }

    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function routeForFile(root, file) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  // For HTML files, use the route directly
  if (rel.endsWith(".html")) {
    return rel === "index.html" ? "/" : "/" + rel.replace(/\.html$/, "");
  }
  // For CSS/JS/other assets, associate with the HTML in the same directory
  const dir = path.dirname(rel);
  return dir === "." ? "/" : "/" + dir;
}

function isText(m) {
  return /^text\/|^application\/(javascript|json|xml)/.test(m);
}

function signEvent(skHex, pubkey, draft) {
  const event = {
    ...draft,
    pubkey,
  };
  return finalizeEvent(event, skHex);
}

async function connectRelays(urls) {
  const conns = [];
  console.log(`\n🔌 Connecting to ${urls.length} relay(s)...`);
  for (const u of urls) {
    try {
      const r = new Relay(u);
      await r.connect();
      conns.push({ relay: r, url: u, connected: true });
      console.log(`   ✓ Connected to ${u}`);
    } catch (e) {
      console.warn(`   ✗ Failed to connect to ${u}: ${e.message}`);
      conns.push({ relay: null, url: u, connected: false });
    }
  }
  const connectedCount = conns.filter((c) => c.connected).length;
  console.log(`   Connected to ${connectedCount}/${urls.length} relay(s)\n`);
  return conns;
}

/**
 * Delete event from specific relays
 */
async function deleteEventFromRelays(
  conns,
  eventId,
  reason = "Rollback due to incomplete publish"
) {
  const SK = process.env._CURRENT_SK; // Set during main()

  if (!SK) {
    console.warn(
      `   ⚠️  Cannot delete event ${eventId.substring(
        0,
        8
      )} - no private key available`
    );
    return;
  }

  // Create deletion event (kind 5)
  const deleteEvent = {
    kind: 5,
    created_at: now(),
    tags: [
      ["e", eventId],
      ["reason", reason],
    ],
    content: reason,
  };

  const signedDelete = signEvent(SK, getPublicKey(SK), deleteEvent);

  const results = await Promise.allSettled(
    conns
      .filter((c) => c.connected)
      .map(async (c) => {
        try {
          await c.relay.publish(signedDelete);
          return { url: c.url, status: "success" };
        } catch (e) {
          return { url: c.url, status: "failed", reason: e.message };
        }
      })
  );

  const successful = results.filter(
    (r) => r.status === "fulfilled" && r.value.status === "success"
  ).length;
  return successful;
}

async function publishToRelays(
  conns,
  ev,
  relayStats = null,
  retryCount = 2,
  publishLog = null
) {
  const connectedRelays = conns.filter((c) => c.connected);

  if (connectedRelays.length === 0) {
    throw new Error(`No connected relays available for event ${ev.id}`);
  }

  let results = [];

  // Try publishing to all relays with retries
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    const relaysToTry =
      attempt === 0
        ? connectedRelays
        : connectedRelays.filter(
            (c, idx) => results[idx]?.status !== "success"
          );

    if (relaysToTry.length === 0) break; // All succeeded

    if (attempt > 0) {
      console.log(
        `   🔄 Retrying ${relaysToTry.length} relay(s) (attempt ${
          attempt + 1
        }/${retryCount + 1})...`
      );
      // Wait a bit before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const attemptResults = await Promise.allSettled(
      relaysToTry.map(async (c) => {
        try {
          await c.relay.publish(ev);
          return { url: c.url, status: "success" };
        } catch (e) {
          return { url: c.url, status: "failed", reason: e.message };
        }
      })
    );

    // Update results
    if (attempt === 0) {
      results = attemptResults.map((r) =>
        r.status === "fulfilled"
          ? r.value
          : { status: "failed", reason: "rejected" }
      );
    } else {
      let retryIdx = 0;
      for (let i = 0; i < results.length; i++) {
        if (
          results[i].status !== "success" &&
          retryIdx < attemptResults.length
        ) {
          if (attemptResults[retryIdx].status === "fulfilled") {
            results[i] = attemptResults[retryIdx].value;
          }
          retryIdx++;
        }
      }
    }
  }

  // Update stats and track successful publishes per relay
  const successful = [];
  const failed = [];

  connectedRelays.forEach((c, idx) => {
    if (results[idx]?.status === "success") {
      successful.push(c.url);
      if (relayStats && relayStats[c.url]) {
        relayStats[c.url].published++;
      }
      // Track for potential rollback
      if (publishLog) {
        if (!publishLog[c.url]) publishLog[c.url] = [];
        publishLog[c.url].push(ev.id);
      }
    } else {
      failed.push({ url: c.url, reason: results[idx]?.reason || "unknown" });
      if (relayStats && relayStats[c.url]) {
        relayStats[c.url].failed++;
      }
    }
  });

  if (successful.length === 0) {
    throw new Error(`All relays failed to accept event ${ev.id}`);
  }

  // Warn if not all relays succeeded
  if (failed.length > 0) {
    console.warn(
      `   ⚠️  Warning: ${failed.length}/${
        connectedRelays.length
      } relay(s) failed for event ${ev.id.substring(0, 8)}...`
    );
    failed.forEach((f) => console.warn(`      - ${f.url}: ${f.reason}`));
  }

  // Return summary
  return {
    successful: successful.length,
    failed: failed.length,
    total: connectedRelays.length,
    failedRelays: failed.map((f) => f.url),
    successfulRelays: successful,
  };
}

async function main() {
  const [, , siteDirArg] = process.argv;

  // Show help
  if (siteDirArg === "--help" || siteDirArg === "-h") {
    console.log(`
🚀 Nostr Web Deploy

Deploy your website to Nostr relays.
Publishes HTML, CSS, JS, and media files as Nostr events.

Usage: nw-publisher deploy <site-folder> [options]

Arguments:
  site-folder       Path to your website directory (required)

Options:
  --version=X.Y.Z   Set a custom version (e.g., --version=2.0.0)
  --rebuild-cache   Query relays to rebuild cache (ignore local files)
  -h, --help        Show this help message

Examples:
  # Deploy current directory
  nw-publisher deploy .
  
  # Deploy specific folder
  nw-publisher deploy ./my-site
  nw-publisher deploy examples/hello-world
  
  # Set a custom version
  nw-publisher deploy . --version=2.0.0
  
  # Force rebuild cache from relays
  nw-publisher deploy . --rebuild-cache

Requirements:
  - NOSTR_SK_HEX in .env (or generates new keypair)
  - RELAYS in .env (comma-separated relay URLs)
  - Site directory with index.html

What it does:
  1. Loads/generates keypair
  2. Processes all site files (HTML, CSS, JS)
  3. Creates and publishes Nostr events for assets
  4. Creates manifest and site index events
  5. Generates DNS TXT record instructions
  6. Caches events for future updates
`);
    process.exit(0);
  }

  if (!siteDirArg) {
    console.error("Usage: nw-publisher deploy <site-folder>");
    process.exit(1);
  }
  const siteDir = path.resolve(siteDirArg);
  if (!fs.existsSync(siteDir) || !fs.statSync(siteDir).isDirectory())
    throw new Error(`No such folder: ${siteDir}`);

  // Load keypair (from env, file, or generate new)
  const { SK, pubkey, npub } = loadOrGenerateKeypair(siteDir);

  // Store SK globally for delete operations
  process.env._CURRENT_SK = SK;

  // Load other configuration
  const { relays, host } = readEnv();
  const relayUrls = parseRelayUrls(relays);
  const conns = await connectRelays(relayUrls);

  // Check for --rebuild-cache flag
  const forceRebuild = process.argv.includes("--rebuild-cache");
  if (forceRebuild) {
    console.log("🔄 Rebuilding cache from relays...\n");
  }

  // Check for --version flag
  let customVersion = null;
  const versionArg = process.argv.find((arg) => arg.startsWith("--version="));
  if (versionArg) {
    const versionStr = versionArg.split("=")[1];
    customVersion = parseVersion(versionStr);
    if (!customVersion) {
      console.error(`\n❌ Error: Invalid version format "${versionStr}"`);
      console.error("   Expected format: X.Y.Z (e.g., 1.0.0, 2.3.1)\n");
      process.exit(1);
    }
    console.log(`\n📌 Using custom version: ${customVersion}`);
  }

  // Load cache from previous publish (or query relays)
  const cache = await loadEventCache(siteDir, relayUrls, pubkey, forceRebuild);
  let assetsReused = 0;
  let assetsPublished = 0;

  // Track relay publish statistics and published events for rollback
  const relayStats = {};
  const publishLog = {}; // Track which events were published to which relays
  for (const conn of conns) {
    relayStats[conn.url] = {
      connected: conn.connected,
      published: 0,
      failed: 0,
    };
    publishLog[conn.url] = [];
  }

  const assetBuckets = {}; // route -> { html, css:[], js:[], comps:[] }
  const immutableEvents = [];
  const manifestEvents = [];

  // 1) Upload media / publish text assets
  console.log("\n📝 Processing assets...");
  for await (const file of walk(siteDir)) {
    // Skip cache and keypair files
    const fileName = path.basename(file);
    if (fileName === ".nweb-cache.json" || fileName === ".nweb-keypair.json") {
      continue;
    }

    const buf = fs.readFileSync(file);
    const mtype = mime.getType(file) || "application/octet-stream";
    const route = routeForFile(siteDir, file);

    const content = isText(mtype) ? buf.toString("utf8") : buf.toString("utf8");
    const contentHash = sha256Hex(buf);
    const kind = 1125; // All assets use kind 1125 (Regular Assets)
    const tags = [
      ["m", mtype], // MIME type
      ["x", contentHash], // Content hash (required for all assets)
    ];

    // Check if we already have this content published
    const cacheKey = `${kind}:${contentHash}`;
    let eventId = cache.assets[cacheKey];

    if (eventId) {
      // Reuse existing event
      console.log(`[CACHED] ${route} kind=${kind} id=${eventId} (unchanged)`);
      assetsReused++;
    } else {
      // Publish new event
      const ev = signEvent(SK, pubkey, {
        kind,
        created_at: now(),
        tags,
        content,
      });
      await publishToRelays(conns, ev, relayStats, 2, publishLog);
      immutableEvents.push(ev);
      eventId = ev.id;

      // Store in cache
      cache.assets[cacheKey] = eventId;
      console.log(`[ASSET] ${route} kind=${kind} id=${eventId} (new)`);
      assetsPublished++;
    }

    // Store event ID in bucket by MIME type
    const bucket = (assetBuckets[route] ||= {
      html: null,
      css: [],
      js: [],
      comps: [],
    });

    if (mtype === "text/html") {
      bucket.html = eventId;
    } else if (mtype === "text/css") {
      bucket.css.push(eventId);
    } else if (
      mtype === "application/javascript" ||
      mtype === "text/javascript"
    ) {
      bucket.js.push(eventId);
    } else {
      bucket.comps.push(eventId);
    }
  }

  console.log(
    `\n✅ Assets: ${assetsReused} reused, ${assetsPublished} published`
  );

  // 2) Manifests (1126 - Regular events)
  console.log("\n📋 Processing manifests...");

  // Find all HTML files to ensure we create manifests for all routes
  console.log("🔍 Scanning for HTML files...");
  const htmlFiles = findHTMLFiles(siteDir);
  console.log(`   Found ${htmlFiles.length} HTML file(s)`);
  for (const { route } of htmlFiles) {
    console.log(`   - ${route}`);
  }

  // First, collect global CSS/JS from root route
  const globalCSS = assetBuckets["/"]?.css || [];
  const globalJS = assetBuckets["/"]?.js || [];

  // Create manifests for all HTML routes found
  for (const { route } of htmlFiles) {
    const ids = assetBuckets[route] || {
      html: null,
      css: [],
      js: [],
      comps: [],
    };

    if (!ids.html) {
      console.warn(`[SKIP] manifest for ${route} (HTML not found in assets)`);
      continue;
    }

    // According to NIP-YY: Page Manifest (1126) is a regular event
    // Required tags: 'e' tags with asset event IDs (kind 1125)
    // Optional tags: title, description, route, csp
    const tags = [
      ["route", route], // For reference
    ];

    // Add asset references using 'e' tags with relay hint
    tags.push(["e", ids.html, relays[0] || ""]);

    // Include route-specific CSS plus global CSS from root
    const allCSS = route === "/" ? ids.css : [...globalCSS, ...ids.css];
    const allJS = route === "/" ? ids.js : [...globalJS, ...ids.js];

    for (const c of allCSS) tags.push(["e", c, relays[0] || ""]);
    for (const j of allJS) tags.push(["e", j, relays[0] || ""]);
    for (const c of ids.comps) tags.push(["e", c, relays[0] || ""]);

    // Extract title from route (e.g., /about -> About, /posts/welcome -> Welcome)
    const routeParts = route.split("/").filter(Boolean);
    const title =
      routeParts.length === 0
        ? "Home"
        : routeParts[routeParts.length - 1]
            .split("-")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");

    tags.push(["title", title]);
    tags.push(["description", `Page: ${title}`]);

    // Page manifests now use empty content (metadata in tags)
    const content = "";

    // Check if manifest changed by comparing asset IDs
    const manifestKey = `manifest:${route}`;
    const assetIds = [ids.html, ...allCSS, ...allJS, ...ids.comps]
      .filter(Boolean)
      .sort()
      .join(",");

    const cachedManifestData = cache.manifests[manifestKey];

    // Page Manifest (kind 1126) is now a REGULAR event (not addressable).
    // We create a new manifest event only if the asset references changed.
    // The site index will reference these manifest event IDs.

    let manifestId;

    if (cachedManifestData && cachedManifestData.assetIds === assetIds) {
      // Reuse existing manifest (assets unchanged)
      manifestId = cachedManifestData.id;
      console.log(
        `[MANIF] ${route} -> ${manifestId} (reused, content unchanged)`
      );
    } else {
      // Publish new manifest
      const ev = signEvent(SK, pubkey, {
        kind: 1126, // Regular event (not addressable)
        created_at: now(),
        tags,
        content,
      });
      await publishToRelays(conns, ev, relayStats, 2, publishLog);
      manifestEvents.push(ev);
      manifestId = ev.id;

      // Store in cache
      cache.manifests[manifestKey] = {
        id: manifestId,
        assetIds: assetIds,
      };

      console.log(`[MANIF] ${route} -> ${manifestId} (new/updated)`);
    }

    // Keep track of manifest for site index
    if (cachedManifestData && cachedManifestData.assetIds === assetIds) {
      // Even when reusing, we need to track the manifest ID
      manifestEvents.push({ id: manifestId, tags: [["route", route]] });
    }
  }

  // 3) Site index (31126 - Addressable event)
  console.log("\n🗂️  Updating site index...");

  // Build routes object for content
  const routes = {};
  for (const m of manifestEvents) {
    const routeTag = m.tags ? m.tags.find((t) => t[0] === "route") : null;
    const route = routeTag ? routeTag[1] : "/";
    routes[route] = m.id;
  }

  console.log(
    `   Creating site index with ${Object.keys(routes).length} route(s):`
  );
  for (const route of Object.keys(routes).sort()) {
    console.log(`   - ${route} → ${routes[route]}`);
  }

  // Load version history (or query relays)
  const versionHistory = await loadVersionHistory(
    siteDir,
    relayUrls,
    pubkey,
    forceRebuild
  );

  // Build preliminary site index content to check for changes
  const preliminarySiteIndexContent = JSON.stringify({
    routes,
    defaultRoute: routes["/"] ? "/" : Object.keys(routes).sort()[0] || "/",
    notFoundRoute: routes["/404"] || null,
  });

  // Determine version: use custom if provided, otherwise auto-increment
  let newVersion;
  let changeType;

  if (customVersion) {
    // User specified custom version
    newVersion = customVersion;
    changeType = "manual";
    console.log(
      `   Version: ${versionHistory.current} → ${newVersion} (custom)`
    );
  } else {
    // Auto-increment version based on changes
    changeType = detectChangeType(
      cache,
      manifestEvents,
      preliminarySiteIndexContent
    );

    // If no cached site index, this is first deployment - use current version as-is
    // Otherwise, increment based on change type
    if (!cache.siteIndex) {
      newVersion = versionHistory.current;
      console.log(`   Version: ${newVersion} (initial deployment)`);
    } else {
      newVersion = incrementVersion(versionHistory.current, changeType);
      console.log(
        `   Version: ${versionHistory.current} → ${newVersion} (${changeType} update)`
      );
    }
  }

  // Build site index content with version
  // IMPORTANT: Only include content-addressable data (routes)
  // DO NOT include timestamps or other dynamic data that would change the hash
  const siteIndexContent = JSON.stringify({
    routes,
    defaultRoute: routes["/"] ? "/" : Object.keys(routes).sort()[0] || "/",
    notFoundRoute: routes["/404"] || null,
    version: newVersion,
  });

  // Compute content hash for the 'd' tag
  const contentHash = sha256Hex(Buffer.from(siteIndexContent, "utf8"));
  const truncatedHash = contentHash.substring(0, 8); // Use first 8 characters (like Git short hash)

  const indexTags = [
    ["d", truncatedHash], // Truncated hash for addressable event
    ["x", contentHash], // Full hash for verification
    ["alt", "main"], // Human-readable identifier
  ];

  // Check if site index changed
  const cachedSiteIndex = cache.siteIndex;

  let siteIndexId;
  let siteIndexUpdated = false; // Track if we published a new site index

  // Site index (kind 31126) is an ADDRESSABLE event.
  // The 'd' tag is content-addressed (hash of content).
  // We only publish a new version if the content (routes) actually changed.

  if (cachedSiteIndex && cachedSiteIndex.contentHash === contentHash) {
    // Content unchanged, reuse existing event
    siteIndexId = cachedSiteIndex.id;
    console.log(
      `[INDEX] site-index (d=${truncatedHash}) -> ${siteIndexId} (reused, content unchanged)`
    );
  } else {
    // Content changed, publish new site index
    const siteIndex = signEvent(SK, pubkey, {
      kind: 31126, // Addressable event
      created_at: now(),
      tags: indexTags,
      content: siteIndexContent,
    });
    await publishToRelays(conns, siteIndex, relayStats, 2, publishLog);
    siteIndexId = siteIndex.id;
    siteIndexUpdated = true; // Mark that we published a new site index

    // Update cache
    cache.siteIndex = {
      id: siteIndex.id,
      contentHash: contentHash,
      truncatedHash: truncatedHash,
      routes: routes,
      version: newVersion,
    };

    // Update version history
    versionHistory.current = newVersion;
    versionHistory.versions.push({
      version: newVersion,
      siteIndexId: siteIndex.id,
      contentHash: truncatedHash,
      timestamp: new Date().toISOString(),
      changeType: changeType,
      routes: Object.keys(routes).sort(),
      entrypointId: null, // Will be updated below
    });

    // Keep only last 50 versions (in memory for this deployment)
    if (versionHistory.versions.length > 50) {
      versionHistory.versions = versionHistory.versions.slice(-50);
    }

    // Note: Version history is stored on-chain in site index events, not in local files

    console.log(
      `[INDEX] site-index (d=${truncatedHash}) -> ${siteIndex.id} (updated, v${newVersion})`
    );
  }

  // 4) Entrypoint (11126 - Replaceable event)
  console.log("\n🔗 Updating entrypoint...");

  // Check if we need to update the entrypoint
  const cachedEntrypoint = cache.entrypoint;
  let entrypointId;

  // Update entrypoint if:
  // 1. Site index was updated (new content)
  // 2. Site index hash changed (different routes)
  // 3. No cached entrypoint exists
  const needsEntrypointUpdate =
    siteIndexUpdated ||
    !cachedEntrypoint ||
    cachedEntrypoint.siteIndexHash !== truncatedHash;

  if (!needsEntrypointUpdate) {
    // Site index unchanged and entrypoint exists, reuse it
    entrypointId = cachedEntrypoint.id;
    console.log(
      `[ENTRY] entrypoint -> ${entrypointId} (reused, points to site-index d=${truncatedHash})`
    );
  } else {
    // Site index changed or entrypoint doesn't exist, publish new entrypoint
    // Entrypoint points to the current site index using 'a' tag
    // Format: ["a", "31126:<pubkey>:<d-tag>", "<relay-url>"]
    const entrypointTags = [
      ["a", `31126:${pubkey}:${truncatedHash}`, relays[0] || ""],
    ];

    const entrypoint = signEvent(SK, pubkey, {
      kind: 11126, // Replaceable event
      created_at: now(),
      tags: entrypointTags,
      content: "",
    });
    await publishToRelays(conns, entrypoint, relayStats, 2, publishLog);
    entrypointId = entrypoint.id;

    console.log(
      `[ENTRY] entrypoint -> ${entrypoint.id} (updated, points to site-index d=${truncatedHash})`
    );

    // Update cache with entrypoint
    cache.entrypoint = {
      id: entrypoint.id,
      siteIndexHash: truncatedHash,
    };

    // Update entrypoint ID in latest version history entry (in memory only)
    if (siteIndexUpdated && versionHistory.versions.length > 0) {
      versionHistory.versions[versionHistory.versions.length - 1].entrypointId =
        entrypoint.id;
      // Note: Version history tracked on-chain, not saved locally
    }
  }

  // Note: We no longer save local cache files - we query relays for source of truth

  // Rollback orphaned events from failed relays
  console.log("\n🧹 Cleaning up orphaned events from failed relays...");

  const failedRelays = Object.entries(relayStats)
    .filter(([url, stats]) => stats.connected && stats.failed > 0)
    .map(([url]) => url);

  if (failedRelays.length > 0) {
    console.log(`   Found ${failedRelays.length} relay(s) with failures:`);

    for (const relayUrl of failedRelays) {
      const publishedEvents = publishLog[relayUrl] || [];
      if (publishedEvents.length === 0) {
        console.log(`   ✓ ${relayUrl}: No events to clean up`);
        continue;
      }

      console.log(
        `   🗑️  ${relayUrl}: Deleting ${publishedEvents.length} orphaned event(s)...`
      );

      // Get connection for this relay
      const conn = conns.find((c) => c.url === relayUrl);
      if (!conn || !conn.connected) {
        console.warn(`      ⚠️  Cannot delete - relay not connected`);
        continue;
      }

      let deletedCount = 0;
      for (const eventId of publishedEvents) {
        try {
          const deleted = await deleteEventFromRelays(
            [conn],
            eventId,
            `Rollback: Relay failed to publish all events for this site`
          );
          if (deleted > 0) deletedCount++;
        } catch (e) {
          console.warn(
            `      ⚠️  Failed to delete ${eventId.substring(0, 8)}: ${
              e.message
            }`
          );
        }
      }

      console.log(
        `      ✓ Deleted ${deletedCount}/${publishedEvents.length} event(s)`
      );

      // Update stats to reflect that this relay no longer has the events
      relayStats[relayUrl].published = 0;
      relayStats[relayUrl].failed = 0;
      relayStats[relayUrl].rolledBack = true;
    }
  } else {
    console.log(
      `   ✓ No cleanup needed - all relays either fully successful or not connected`
    );
  }

  // 5) DNS helper - only include relays with 100% success
  if (host) {
    // Filter to only include relays that successfully published all events
    const successfulRelays = relays.filter((url) => {
      const stats = relayStats[url];
      return (
        stats && stats.connected && stats.published > 0 && stats.failed === 0
      );
    });

    if (successfulRelays.length === 0) {
      console.warn(`\n⚠️  Warning: No relays achieved 100% success rate.`);
      console.warn(
        `   DNS record will include all configured relays as fallback.`
      );
      console.warn(
        `   Site accessibility may be limited until issues are resolved.\n`
      );
    }

    // Use successful relays, or all relays as fallback if none succeeded completely
    const relaysForDNS =
      successfulRelays.length > 0 ? successfulRelays : relays;

    const txt = {
      v: 1,
      pk: npub,
      relays: relaysForDNS,
      policy: { min_relays: Math.min(2, relaysForDNS.length) },
    };

    // Write comprehensive file with all options and instructions
    const standardEscaping = JSON.stringify(txt);
    const prettyJson = JSON.stringify(txt, null, 2);
    const doubleEscaped = JSON.stringify(standardEscaping);

    const fileContent = `DNS TXT RECORD SETUP FOR NOSTR WEB
${"=".repeat(70)}

Record Name: _nweb.${host}
Record Type: TXT

IMPORTANT: No DNS updates needed for content changes!
The DNS record only contains your public key. When you republish your
site, clients automatically fetch the latest version from relays.

✅ RELAYS INCLUDED: ${relaysForDNS.length}/${
      relays.length
    } relay(s) with 100% publish success
${
  relaysForDNS.length < relays.length
    ? `
⚠️  NOTE: ${
        relays.length - relaysForDNS.length
      } relay(s) excluded due to publish failures.
   Only fully operational relays are included in the DNS record.
   Excluded relays: ${relays
     .filter((r) => !relaysForDNS.includes(r))
     .join(", ")}
`
    : "   All configured relays are included (all had 100% success).\n"
}
${"=".repeat(70)}
OPTION 1: STANDARD ESCAPING (Try This First)
${"=".repeat(70)}

Most DNS providers (Cloudflare, Google Domains, etc.)
Copy the line below and paste into your DNS TXT record:

${standardEscaping}

${"=".repeat(70)}
OPTION 2: DOUBLE ESCAPING (If Option 1 Doesn't Work)
${"=".repeat(70)}

Some DNS providers automatically unescape quotes.
If Option 1 doesn't work, copy the line below instead:

${doubleEscaped}

${"=".repeat(70)}
HUMAN-READABLE VERSION (For Reference Only - NOT for DNS)
${"=".repeat(70)}

${prettyJson}

${"=".repeat(70)}
WHAT'S IN THE DNS RECORD?
${"=".repeat(70)}

- v: Protocol version (always 1)
- pk: Your site's public key (npub format)
- relays: List of Nostr relays hosting your site
- policy: Connection requirements

${"=".repeat(70)}
HOW IT WORKS (Architecture)
${"=".repeat(70)}

DNS Record → Entrypoint (kind 11126) → Site Index (kind 31126) → Page Manifests (kind 1126) → Assets (kind 1125)

1. DNS contains only your pubkey and relays (static)
2. Clients query for your latest Entrypoint event (kind 11126)
3. Entrypoint points to current Site Index via 'a' tag
4. Site Index maps routes to Page Manifest IDs
5. Page Manifests reference all assets for each page
6. Assets are content-addressed and deduplicated

When you republish:
- New Entrypoint event is published (replaceable, latest wins)
- Points to new Site Index with updated routes
- Clients automatically detect and load new version
- NO DNS changes needed!

NOTE: The site index ID is NO LONGER in DNS!
Clients fetch the latest entrypoint by querying relays, which points
to the current site index. This means you NEVER need to update DNS
when you republish your site - changes are automatic!

${"=".repeat(70)}
VERIFICATION
${"=".repeat(70)}

After adding the DNS record (ONE TIME ONLY):

1. Wait 5-10 minutes for DNS propagation
2. Verify using: dig TXT _nweb.${host}
3. Or visit: https://dns.google/resolve?name=_nweb.${host}&type=TXT
4. Test your site in the Nostr Web extension

After this initial setup, you can republish as many times as you want
without touching DNS. The extension automatically detects new versions!

${"=".repeat(70)}
TROUBLESHOOTING
${"=".repeat(70)}

- DNS not updating? Wait longer (can take up to 48 hours)
- Extension can't load site? Check relay connectivity
- Wrong format error? Try Option 2 (double escaping)
- Need help? Check the documentation in /docs

${"=".repeat(70)}
`;

    fs.writeFileSync(path.join(process.cwd(), "_nweb.txt"), fileContent);

    console.log(
      `\n📄 Wrote _nweb.txt (contains all instructions and both escaping options)`
    );
    console.log(`\n${"=".repeat(70)}`);
    console.log(`DNS TXT RECORD SETUP`);
    console.log(`${"=".repeat(70)}`);
    console.log(`\n✅ All instructions saved to: _nweb.txt`);
    console.log(
      `   Open the file to see both escaping options with full instructions\n`
    );
    console.log(`Record Name: _nweb.${host}`);
    console.log(`Record Type: TXT\n`);
    console.log(
      `Quick Reference - OPTION 1 (Standard Escaping):\n${standardEscaping}\n`
    );
    console.log(`\n📌 DNS Configuration Note:`);
    console.log(
      `   DNS setup is required only once during initial deployment.`
    );
    console.log(
      `   Future updates are published directly to relays without DNS changes.`
    );
    console.log(
      `   Clients automatically retrieve the latest version from Nostr relays.\n`
    );

    // Show relay inclusion status
    if (relaysForDNS.length < relays.length) {
      console.log(`⚠️  RELAY FILTERING:`);
      console.log(
        `   ${relaysForDNS.length}/${relays.length} relay(s) included in DNS record (100% success only)`
      );
      const excluded = relays.filter((r) => !relaysForDNS.includes(r));
      console.log(`   Excluded: ${excluded.join(", ")}`);
      console.log(`   Reason: These relays had publish failures\n`);
    } else {
      console.log(
        `✅ All ${relaysForDNS.length} relay(s) included in DNS record (all had 100% success)\n`
      );
    }

    console.log(`${"=".repeat(70)}\n`);
  }

  // Display relay publish summary with corrective actions
  console.log(`\n${"=".repeat(70)}`);
  console.log(`📡 RELAY PUBLISH SUMMARY`);
  console.log(`${"=".repeat(70)}\n`);

  let hasFailures = false;
  let hasCriticalFailures = false;
  const problematicRelays = [];

  for (const [url, stats] of Object.entries(relayStats)) {
    const total = stats.published + stats.failed;
    const successRate =
      total > 0 ? ((stats.published / total) * 100).toFixed(1) : "0.0";

    if (!stats.connected) {
      console.log(`❌ ${url}`);
      console.log(`   Status: Failed to connect`);
      hasFailures = true;
      hasCriticalFailures = true;
      problematicRelays.push({
        url,
        stats,
        successRate: 0,
        issue: "not_connected",
      });
    } else if (stats.rolledBack) {
      console.log(`🗑️  ${url}`);
      console.log(`   Status: Rolled back (orphaned events deleted)`);
      console.log(`   Reason: Failed to publish complete site`);
      hasFailures = true;
      hasCriticalFailures = true;
      problematicRelays.push({
        url,
        stats,
        successRate: 0,
        issue: "rolled_back",
      });
    } else if (stats.failed > 0) {
      console.log(`⚠️  ${url}`);
      console.log(`   Published: ${stats.published} event(s)`);
      console.log(`   Failed: ${stats.failed} event(s)`);
      console.log(`   Success Rate: ${successRate}%`);
      hasFailures = true;
      if (parseFloat(successRate) < 50) {
        hasCriticalFailures = true;
      }
      problematicRelays.push({
        url,
        stats,
        successRate: parseFloat(successRate),
        issue: "partial_failure",
      });
    } else if (stats.published > 0) {
      console.log(`✅ ${url}`);
      console.log(`   Published: ${stats.published} event(s)`);
      console.log(`   Success Rate: 100%`);
    } else {
      console.log(`⚠️  ${url}`);
      console.log(`   Status: Connected but no events published`);
      hasFailures = true;
      problematicRelays.push({
        url,
        stats,
        successRate: 0,
        issue: "no_publish",
      });
    }
    console.log(``);
  }

  const totalPublished = Object.values(relayStats).reduce(
    (sum, s) => sum + s.published,
    0
  );
  const totalFailed = Object.values(relayStats).reduce(
    (sum, s) => sum + s.failed,
    0
  );
  const connectedRelays = Object.values(relayStats).filter(
    (s) => s.connected
  ).length;
  const successfulRelays = Object.values(relayStats).filter(
    (s) => s.published > 0 && s.failed === 0
  ).length;

  console.log(
    `Summary: ${successfulRelays}/${connectedRelays} relay(s) with 100% success`
  );
  console.log(`Total events published: ${totalPublished}`);
  console.log(`Total events failed: ${totalFailed}`);
  console.log(`${"=".repeat(70)}\n`);

  // Corrective actions
  if (hasFailures) {
    console.log(`⚠️  CORRECTIVE ACTIONS REQUIRED`);
    console.log(`${"=".repeat(70)}\n`);

    problematicRelays.sort((a, b) => a.successRate - b.successRate);

    for (const relay of problematicRelays) {
      console.log(`${relay.url}:`);
      console.log(
        `  Issue: ${
          relay.issue === "not_connected"
            ? "Connection Failed"
            : relay.issue === "rolled_back"
            ? "Rolled Back"
            : relay.issue === "no_publish"
            ? "No Events Published"
            : "Partial Failure"
        }`
      );
      console.log(`  Success Rate: ${relay.successRate}%`);
      console.log(``);

      if (relay.issue === "not_connected") {
        console.log(`  📋 Recommended Actions:`);
        console.log(
          `     1. Verify relay is operational: https://nostr.watch/relay/${encodeURIComponent(
            relay.url
          )}`
        );
        console.log(
          `     2. Check network connectivity (firewall, proxy settings)`
        );
        console.log(`     3. Try connecting manually: wscat -c ${relay.url}`);
        console.log(`     4. Consider removing this relay from .env file`);
      } else if (relay.issue === "rolled_back") {
        console.log(`  📋 Recommended Actions:`);
        console.log(
          `     1. All orphaned events have been automatically deleted`
        );
        console.log(`     2. This relay will NOT be included in DNS record`);
        console.log(
          `     3. Identify why some events failed (rate limits, size limits, etc.)`
        );
        console.log(`     4. Fix the underlying issue before next publish`);
        console.log(`     5. Consider using a more reliable relay`);
      } else if (relay.successRate === 0) {
        console.log(`  📋 Recommended Actions:`);
        console.log(
          `     1. Check if relay accepts these event kinds (1125, 1126, 31126, 11126)`
        );
        console.log(`     2. Verify relay policies and rate limits`);
        console.log(`     3. Check relay logs/status for errors`);
        console.log(`     4. Test with a simpler event to isolate issue`);
        console.log(
          `     5. Consider replacing with reliable relay (e.g., relay.nostr.band)`
        );
      } else if (relay.successRate < 50) {
        console.log(`  📋 Recommended Actions:`);
        console.log(`     1. Check relay rate limits or quotas`);
        console.log(`     2. Verify event size limits (large assets may fail)`);
        console.log(
          `     3. Monitor relay for intermittent connectivity issues`
        );
        console.log(`     4. Retry publishing or use manual retry`);
        console.log(`     5. Consider adding backup relay for redundancy`);
      } else {
        console.log(`  📋 Recommended Actions:`);
        console.log(
          `     1. Monitor which specific events failed (check logs)`
        );
        console.log(`     2. Verify relay rate limits during high traffic`);
        console.log(`     3. Continue monitoring - may be temporary issue`);
      }
      console.log(``);
    }

    console.log(`🔧 General Recommendations:`);
    console.log(`   • Use 3-5 reliable relays for redundancy`);
    console.log(
      `   • Popular relays:     shu01.shugur.net, relay.nostr.band, nos.lol, relay.damus.io`
    );
    console.log(`   • Monitor relay health: https://nostr.watch/`);
    console.log(`   • Test individual relays before production use`);
    console.log(`   • Keep relay list updated in .env file`);
    console.log(`${"=".repeat(70)}\n`);

    // Exit with appropriate code
    if (hasCriticalFailures) {
      console.log(`❌ Deployment completed with critical errors (exit code 1)`);
      console.log(
        `   Multiple relay failures detected. Review corrective actions above.\n`
      );
      process.exit(1);
    } else {
      console.log(`⚠️  Deployment completed with warnings (exit code 0)`);
      console.log(
        `   Minor issues detected. Site published successfully with some relay failures.\n`
      );
      process.exit(0);
    }
  } else {
    console.log(`✅ Deployment successful - All relays operational.\n`);
    process.exit(0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
