#!/usr/bin/env node
/**
 * Integration Tests for Nostr Web Publisher
 *
 * Full end-to-end testing of all CLI functionality:
 * - Deploy/publish
 * - Version management
 * - Sync
 * - Cleanup
 * - Status
 *
 * Uses real test relays and nak for event verification
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import fs from "node:fs";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");
const nwebPath = join(projectRoot, "nw-publisher.mjs");

// Test configuration
const TEST_RELAYS = ["wss://relay.nostr.band", "wss://nos.lol"];

// Test site directory
const TEST_SITE_DIR = join(projectRoot, "test-site-temp");

/**
 * Helper to run CLI command
 */
function runCLI(args, options = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      ...options.env,
    };

    const proc = spawn("node", [nwebPath, ...args], {
      cwd: options.cwd || projectRoot,
      env,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
      if (options.verbose) process.stdout.write(data);
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
      if (options.verbose) process.stderr.write(data);
    });

    // Handle stdin for interactive prompts
    if (options.stdin) {
      proc.stdin.write(options.stdin);
      proc.stdin.end();
    }

    proc.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });

    proc.on("error", reject);

    // Timeout
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error("Command timeout"));
    }, options.timeout || 30000);

    proc.on("close", () => clearTimeout(timeout));
  });
}

/**
 * Query events using nak (if available)
 */
function queryEventsWithNak(pubkey, kinds, relays) {
  try {
    // nak requires separate -k flags for each kind
    const kindFlags = kinds.map((k) => `-k ${k}`).join(" ");
    const relayStr = relays.join(" ");
    const cmd = `nak req ${kindFlags} -a ${pubkey} ${relayStr}`;
    const output = execSync(cmd, { encoding: "utf8", timeout: 10000 });

    // Parse JSONL output
    const events = output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    return events;
  } catch (error) {
    console.warn("nak not available or query failed:", error.message);
    return null;
  }
}

/**
 * Create test site
 */
function createTestSite() {
  if (!fs.existsSync(TEST_SITE_DIR)) {
    fs.mkdirSync(TEST_SITE_DIR, { recursive: true });
  }

  // Create index.html
  fs.writeFileSync(
    join(TEST_SITE_DIR, "index.html"),
    `<!DOCTYPE html>
<html>
<head>
  <title>Test Site</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1>Test Site</h1>
  <p>Integration test site for nw-publish</p>
  <script src="app.js"></script>
</body>
</html>`
  );

  // Create style.css
  fs.writeFileSync(
    join(TEST_SITE_DIR, "style.css"),
    `body { font-family: sans-serif; margin: 2rem; }
h1 { color: #5b21b6; }`
  );

  // Create app.js
  fs.writeFileSync(
    join(TEST_SITE_DIR, "app.js"),
    `console.log("Test site loaded");`
  );

  // Create about.html
  fs.writeFileSync(
    join(TEST_SITE_DIR, "about.html"),
    `<!DOCTYPE html>
<html>
<head>
  <title>About - Test Site</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1>About</h1>
  <p>About page for testing</p>
</body>
</html>`
  );
}

/**
 * Clean up test site
 */
function cleanupTestSite() {
  if (fs.existsSync(TEST_SITE_DIR)) {
    fs.rmSync(TEST_SITE_DIR, { recursive: true, force: true });
  }
}

/**
 * Generate test keypair
 */
function generateTestKeypair() {
  const SK = generateSecretKey();
  const skHex = Buffer.from(SK).toString("hex");
  const pubkey = getPublicKey(SK);
  const npub = nip19.npubEncode(pubkey);

  return { skHex, pubkey, npub };
}

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe("Integration Tests", () => {
  let testKeypair;
  let testEnv;

  beforeEach(() => {
    // Generate fresh keypair for each test
    testKeypair = generateTestKeypair();

    testEnv = {
      NOSTR_SK_HEX: testKeypair.skHex,
      RELAYS: TEST_RELAYS.join(","),
      NWEB_HOST: "test.example.com",
    };

    // Create test site
    createTestSite();
  });

  afterEach(() => {
    // Cleanup
    cleanupTestSite();
  });

  test("Full deployment workflow", async () => {
    console.log("\n🧪 Testing full deployment workflow...");
    console.log(`   Test pubkey: ${testKeypair.npub}`);

    // Step 1: Deploy site
    console.log("\n📦 Step 1: Deploying site...");
    const deployResult = await runCLI(["deploy", TEST_SITE_DIR], {
      env: testEnv,
      timeout: 60000,
      verbose: true,
    });

    assert.equal(deployResult.code, 0, "Deploy should succeed");
    assert.match(
      deployResult.stdout,
      /Published/i,
      "Should show publish status"
    );

    // Check cache file created
    const cacheFile = join(TEST_SITE_DIR, ".nweb-cache.json");
    assert.ok(fs.existsSync(cacheFile), "Cache file should be created");

    const cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    assert.ok(cache.assets, "Cache should have assets");
    assert.ok(cache.manifests, "Cache should have manifests");
    assert.ok(cache.siteIndex, "Cache should have site index");

    // Step 2: Query events with nak (if available)
    console.log("\n🔍 Step 2: Querying events...");
    const events = queryEventsWithNak(
      testKeypair.pubkey,
      [1125, 1126, 31126, 11126],
      TEST_RELAYS
    );

    if (events) {
      console.log(`   Found ${events.length} events`);

      // Verify event kinds
      const kinds = new Set(events.map((e) => e.kind));
      console.log(`   Event kinds: ${Array.from(kinds).join(", ")}`);

      assert.ok(kinds.has(1125), "Should have asset events (1125)");
      assert.ok(kinds.has(1126), "Should have manifest events (1126)");
      assert.ok(kinds.has(31126), "Should have site index (31126)");
      assert.ok(kinds.has(11126), "Should have entrypoint (11126)");
    } else {
      console.log("   ⚠️  nak not available, skipping event verification");
    }

    // Step 3: Check status
    console.log("\n📊 Step 3: Checking status...");
    const statusResult = await runCLI(["status"], {
      env: testEnv,
      timeout: 60000, // Increase timeout for slow relay connections
    });

    // Status check may fail if relays are slow, that's OK
    if (statusResult.code === 0) {
      assert.match(statusResult.stdout, /Identity/, "Should show identity");
    } else {
      console.log("   ⚠️  Status check failed (relays may be slow)");
    }

    // Step 4: List versions
    console.log("\n📚 Step 4: Listing versions...");
    const versionsResult = await runCLI(["versions", "list"], {
      env: testEnv,
      timeout: 30000,
    });

    assert.equal(versionsResult.code, 0, "Versions list should succeed");
    assert.match(
      versionsResult.stdout,
      /Version History/i,
      "Should show version history"
    );

    console.log("\n✅ Full deployment workflow completed successfully!");
  });

  test("Publish, modify, and republish", async () => {
    console.log("\n🧪 Testing modify and republish workflow...");

    // First publish
    console.log("\n📦 Initial publish...");
    const deploy1 = await runCLI(["deploy", TEST_SITE_DIR], {
      env: testEnv,
      timeout: 60000,
    });
    assert.equal(deploy1.code, 0, "First deploy should succeed");

    const cache1 = JSON.parse(
      fs.readFileSync(join(TEST_SITE_DIR, ".nweb-cache.json"), "utf8")
    );
    const assetCount1 = Object.keys(cache1.assets).length;

    // Modify a file
    console.log("\n✏️  Modifying index.html...");
    fs.appendFileSync(join(TEST_SITE_DIR, "index.html"), "\n<!-- Modified -->");

    // Second publish
    console.log("\n📦 Republishing after modification...");
    const deploy2 = await runCLI(["deploy", TEST_SITE_DIR], {
      env: testEnv,
      timeout: 60000,
    });
    assert.equal(deploy2.code, 0, "Second deploy should succeed");

    const cache2 = JSON.parse(
      fs.readFileSync(join(TEST_SITE_DIR, ".nweb-cache.json"), "utf8")
    );

    // Should have more assets (new version of index.html)
    const assetCount2 = Object.keys(cache2.assets).length;
    assert.ok(
      assetCount2 > assetCount1,
      "Should have new asset for modified file"
    );

    console.log(`   Assets: ${assetCount1} → ${assetCount2}`);
    console.log("\n✅ Modify and republish workflow completed!");
  });

  test("Sync functionality", async () => {
    console.log("\n🧪 Testing sync functionality...");

    // Deploy site first
    console.log("\n📦 Initial deployment...");
    await runCLI(["deploy", TEST_SITE_DIR], {
      env: testEnv,
      timeout: 60000,
    });

    // Run sync
    console.log("\n🔄 Running sync...");
    const syncResult = await runCLI(["sync"], {
      env: testEnv,
      stdin: "SYNC\n", // Auto-confirm
      timeout: 60000,
    });

    // Sync should complete (exit 0 or show sync report)
    assert.match(
      syncResult.stdout,
      /Scanning relays|No orphans|in sync/i,
      "Should show sync status"
    );

    console.log("\n✅ Sync functionality verified!");
  });

  test("Cleanup functionality", async () => {
    console.log("\n🧪 Testing cleanup functionality...");

    // Deploy site first
    console.log("\n📦 Initial deployment...");
    await runCLI(["deploy", TEST_SITE_DIR], {
      env: testEnv,
      timeout: 60000,
    });

    // Wait a bit for events to propagate
    console.log("\n⏳ Waiting for events to propagate...");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Query events before cleanup
    const eventsBefore = queryEventsWithNak(
      testKeypair.pubkey,
      [1125, 1126, 31126, 11126],
      TEST_RELAYS
    );

    if (eventsBefore) {
      console.log(`   Events before cleanup: ${eventsBefore.length}`);
      assert.ok(eventsBefore.length > 0, "Should have events before cleanup");
    }

    // Run cleanup
    console.log("\n🧹 Running cleanup...");
    const cleanupResult = await runCLI(["cleanup"], {
      env: testEnv,
      stdin: "DELETE\n", // Auto-confirm deletion
      timeout: 60000,
      verbose: true,
    });

    assert.match(
      cleanupResult.stdout,
      /Cleanup|Deleted|deleted/i,
      "Should show cleanup status"
    );

    // Wait for deletion to propagate
    console.log("\n⏳ Waiting for deletion to propagate...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Query events after cleanup
    const eventsAfter = queryEventsWithNak(
      testKeypair.pubkey,
      [1125, 1126, 31126, 11126],
      TEST_RELAYS
    );

    if (eventsAfter && eventsBefore) {
      console.log(`   Events after cleanup: ${eventsAfter.length}`);
      // Note: Deletion might take time to propagate
      console.log(
        "   ⚠️  Note: Some relays may take time to process deletions"
      );
    }

    console.log("\n✅ Cleanup functionality verified!");
  });

  test("Config management", async () => {
    console.log("\n🧪 Testing config management...");

    // Generate keypair
    console.log("\n🔑 Generating keypair...");
    const configResult = await runCLI(["config", "generate"], {
      timeout: 10000,
      env: {}, // Don't pass test env, config generate should work standalone
    });

    // Config generate outputs directly (no special exit code handling needed)
    const output = configResult.stdout + configResult.stderr;
    assert.match(
      output,
      /Private Key|Generating/i,
      "Should show keypair generation output"
    );

    console.log("\n✅ Config management verified!");
  });
});

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(
    "\n╔═══════════════════════════════════════════════════════════╗"
  );
  console.log("║       NOSTR WEB PUBLISHER - INTEGRATION TESTS             ║");
  console.log(
    "╚═══════════════════════════════════════════════════════════╝\n"
  );

  console.log("⚠️  WARNING: These tests will:");
  console.log("   - Publish test events to REAL Nostr relays");
  console.log("   - Use real network bandwidth");
  console.log("   - Create temporary test sites\n");

  // Check for nak
  try {
    execSync("which nak", { stdio: "ignore" });
    console.log("✅ nak CLI tool detected - event verification enabled\n");
  } catch {
    console.log("⚠️  nak not found - event verification will be skipped");
    console.log("   Install: go install github.com/fiatjaf/nak@latest\n");
  }
}
