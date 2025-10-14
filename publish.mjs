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

dotenv.config();

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
  console.log(`\n⚠️  IMPORTANT: Save your private key securely!`);
  console.log(`  Public Key (npub): ${npub}`);
  console.log(`  Private Key (nsec): ${nsec}`);
  console.log(`\n  To reuse this keypair later:`);
  console.log(
    `  - Keep the .nweb-keypair.json file in your site directory, OR`
  );
  console.log(`  - Set NOSTR_SK_HEX=${SK} in your .env file\n`);

  return { SK, pubkey, npub, source: "generated" };
}

function readEnv() {
  const relays = (process.env.RELAYS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!relays.length) throw new Error("RELAYS is required (comma-separated)");
  const blossom = (process.env.BLOSSOM_ENDPOINTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const host = (process.env.NWEB_HOST || "").trim();
  return { relays, blossom, host };
}

/**
 * Load cached event mappings (content hash -> event ID)
 */
function loadEventCache(siteDir) {
  const cachePath = path.join(siteDir, ".nweb-cache.json");
  if (fs.existsSync(cachePath)) {
    try {
      return JSON.parse(fs.readFileSync(cachePath, "utf8"));
    } catch (e) {
      console.warn(`⚠ Failed to read cache file: ${e.message}`);
    }
  }
  return { assets: {}, manifests: {}, siteIndex: null };
}

/**
 * Save event cache to disk
 */
function saveEventCache(siteDir, cache) {
  const cachePath = path.join(siteDir, ".nweb-cache.json");
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
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
function isMedia(m) {
  return /^image\/|^audio\/|^video\/|^font\//.test(m);
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
  for (const u of urls) {
    const r = new Relay(u);
    await r.connect();
    conns.push(r);
  }
  return conns;
}

async function publishToRelays(conns, ev) {
  const results = await Promise.allSettled(conns.map((r) => r.publish(ev)));
  const ok = results.filter((r) => r.status === "fulfilled").length;
  if (!ok) throw new Error(`Publish failed for event ${ev.id}`);
}

async function uploadBlossom(endpoints, buf, mtype) {
  if (!endpoints?.length) return null;
  const u = endpoints[0].replace(/\/+$/, "") + "/upload";
  const r = await fetch(u, {
    method: "POST",
    headers: { "content-type": mtype },
    body: buf,
  });
  if (!r.ok) throw new Error(`Blossom upload failed: ${r.status}`);
  const j = await r.json().catch(() => ({}));
  return j.url || j.hash || null;
}

async function main() {
  const [, , siteDirArg] = process.argv;
  if (!siteDirArg) {
    console.error("Usage: nw-publish <site-folder>");
    process.exit(1);
  }
  const siteDir = path.resolve(siteDirArg);
  if (!fs.existsSync(siteDir) || !fs.statSync(siteDir).isDirectory())
    throw new Error(`No such folder: ${siteDir}`);

  // Load keypair (from env, file, or generate new)
  const { SK, pubkey, npub } = loadOrGenerateKeypair(siteDir);

  // Load other configuration
  const { relays, blossom, host } = readEnv();
  const conns = await connectRelays(relays);

  // Load cache from previous publish
  console.log("\n📦 Loading cache from previous publish...");
  const cache = loadEventCache(siteDir);
  let assetsReused = 0;
  let assetsPublished = 0;

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

    if (isMedia(mtype)) {
      const url = await uploadBlossom(blossom, buf, mtype);
      console.log(`[MEDIA] ${route} -> ${url || "(uploaded)"}`);
      continue;
    }

    const content = isText(mtype) ? buf.toString("utf8") : buf.toString("utf8");
    const contentHash = sha256Hex(buf);
    let kind = 40000;
    const tags = [["m", mtype]];

    if (mtype === "text/css") {
      kind = 40001;
      tags.push(["sha256", contentHash]); // REQUIRED for CSS
    } else if (
      mtype === "application/javascript" ||
      mtype === "text/javascript"
    ) {
      kind = 40002;
      tags.push(["sha256", contentHash]); // REQUIRED for JS
    } else if (mtype === "text/html") {
      kind = 40000;
      tags.push(["sha256", contentHash]); // REQUIRED for HTML
    } else {
      kind = 40003;
      tags.push(["sha256", contentHash]); // REQUIRED for components
    }

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
      await publishToRelays(conns, ev);
      immutableEvents.push(ev);
      eventId = ev.id;

      // Store in cache
      cache.assets[cacheKey] = eventId;
      console.log(`[ASSET] ${route} kind=${kind} id=${eventId} (new)`);
      assetsPublished++;
    }

    const bucket = (assetBuckets[route] ||= {
      html: null,
      css: [],
      js: [],
      comps: [],
    });
    if (kind === 40000) bucket.html = eventId;
    if (kind === 40001) bucket.css.push(eventId);
    if (kind === 40002) bucket.js.push(eventId);
    if (kind === 40003) bucket.comps.push(eventId);
  }

  console.log(
    `\n✅ Assets: ${assetsReused} reused, ${assetsPublished} published`
  );

  // 2) Manifests (34235)
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

    const tags = [["d", route]];
    tags.push(["e", ids.html, "html"]);

    // Include route-specific CSS plus global CSS from root
    const allCSS = route === "/" ? ids.css : [...globalCSS, ...ids.css];
    const allJS = route === "/" ? ids.js : [...globalJS, ...ids.js];

    for (const c of allCSS) tags.push(["e", c, "css"]);
    for (const j of allJS) tags.push(["e", j, "js"]);
    for (const c of ids.comps) tags.push(["e", c, "component"]);

    // Extract title from route (e.g., /about -> About, /posts/welcome -> Welcome)
    const routeParts = route.split("/").filter(Boolean);
    const title =
      routeParts.length === 0
        ? "Home"
        : routeParts[routeParts.length - 1]
            .split("-")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");

    const content = JSON.stringify({
      title,
      csp: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:", "blossom:"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
      version: new Date().toISOString(),
    });

    // Check if manifest changed by comparing asset IDs
    const manifestKey = `manifest:${route}`;
    const assetIds = [ids.html, ...allCSS, ...allJS, ...ids.comps]
      .filter(Boolean)
      .sort()
      .join(",");

    const cachedManifestData = cache.manifests[manifestKey];

    // IMPORTANT: Manifests (kind 34235) are ADDRESSABLE/REPLACEABLE events.
    // We MUST always publish a new version, even if asset IDs unchanged,
    // because addressable events replace previous versions on relays.
    // This ensures the site_index timestamp updates correctly.

    const ev = signEvent(SK, pubkey, {
      kind: 34235,
      created_at: now(),
      tags,
      content,
    });
    await publishToRelays(conns, ev);
    manifestEvents.push(ev);

    // Store in cache
    cache.manifests[manifestKey] = {
      id: ev.id,
      assetIds: assetIds,
    };

    if (cachedManifestData && cachedManifestData.assetIds === assetIds) {
      console.log(
        `[MANIF] ${route} -> ${ev.id} (republished, content unchanged)`
      );
    } else {
      console.log(`[MANIF] ${route} -> ${ev.id} (updated)`);
    }
  }

  // 3) Site index (34236)
  console.log("\n🗂️  Updating site index...");
  const indexTags = [["d", "site-index"]];
  const routes = {}; // Map routes to manifest IDs for content JSON

  for (const m of manifestEvents) {
    const r = (m.tags.find((t) => t[0] === "d") || [, "/"])[1];
    indexTags.push(["route", m.id, r]);
    routes[r] = m.id; // Add to routes object for content
  }

  console.log(
    `   Creating site index with ${Object.keys(routes).length} route(s):`
  );
  for (const route of Object.keys(routes).sort()) {
    console.log(`   - ${route} → ${routes[route]}`);
  }

  // Check if site index changed by comparing manifest IDs
  const manifestIds = manifestEvents
    .map((m) => m.id)
    .sort()
    .join(",");
  const cachedSiteIndex = cache.siteIndex;

  let siteIndexId;

  // IMPORTANT: Site index (kind 34236) is an ADDRESSABLE/REPLACEABLE event.
  // We MUST always publish a new version, even if manifest IDs unchanged,
  // because:
  // 1. Addressable events replace previous versions on relays
  // 2. Extension needs fresh timestamp to detect "this site was republished"
  // 3. Multiple sites sharing same pubkey need distinct timestamps to determine newest
  // This ensures the extension always loads the most recently published site.

  const siteIndex = signEvent(SK, pubkey, {
    kind: 34236,
    created_at: now(),
    tags: indexTags,
    content: JSON.stringify({
      routes, // Include all routes in content for extension to read
      defaultRoute: routes["/"] ? "/" : Object.keys(routes).sort()[0] || "/",
      notFoundRoute: routes["/404"] || null,
      version: "1.0.0",
      published_at: new Date().toISOString(),
    }),
  });
  await publishToRelays(conns, siteIndex);
  siteIndexId = siteIndex.id;

  // Update cache
  cache.siteIndex = {
    id: siteIndex.id,
    manifestIds: manifestIds,
  };
  saveEventCache(siteDir, cache);

  if (cachedSiteIndex && cachedSiteIndex.manifestIds === manifestIds) {
    console.log(
      `[INDEX] site-index -> ${siteIndex.id} (republished, content unchanged)`
    );
  } else {
    console.log(`[INDEX] site-index -> ${siteIndex.id} (updated)`);
  }

  // 4) DNS helper
  if (host) {
    const txt = {
      v: 1,
      pk: npub,
      relays,
      blossom,
      policy: { min_relays: 2 },
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
- blossom: Media server endpoints (optional)
- policy: Connection requirements

NOTE: The site_index event ID is NO LONGER in DNS!
Clients fetch the latest site index by querying relays for the most
recent event from your public key. This means you NEVER need to update
DNS when you republish your site - changes are automatic!

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
    console.log(`\n🎉 GREAT NEWS: You only need to set DNS ONCE!`);
    console.log(
      `   After initial DNS setup, republish as many times as you want.`
    );
    console.log(
      `   Clients automatically fetch the latest version from relays.`
    );
    console.log(`   No DNS updates needed!\n`);
    console.log(`${"=".repeat(70)}\n`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
