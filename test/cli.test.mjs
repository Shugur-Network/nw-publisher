import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");
const nwebPath = join(projectRoot, "nweb.mjs");

/**
 * Helper to run CLI command and capture output
 */
function runCLI(args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [nwebPath, ...args], {
      cwd: projectRoot,
      env: { ...process.env, ...options.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });

    proc.on("error", reject);

    // Kill after timeout
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error("Command timeout"));
    }, options.timeout || 5000);

    proc.on("close", () => clearTimeout(timeout));
  });
}

test("CLI help command", async () => {
  const result = await runCLI(["--help"]);
  assert.equal(result.code, 0, "Help should exit with code 0");
  assert.match(result.stdout, /NOSTR WEB CLI/, "Help should show CLI title");
  assert.match(result.stdout, /CORE COMMANDS/, "Help should list commands");
  assert.match(result.stdout, /deploy/, "Help should mention deploy command");
});

test("CLI version command", async () => {
  const result = await runCLI(["--version"]);
  assert.equal(result.code, 0, "Version should exit with code 0");
  assert.match(
    result.stdout,
    /nweb v\d+\.\d+\.\d+/,
    "Version should show version number"
  );
});

test("deploy command shows usage when no args", async () => {
  const result = await runCLI(["deploy"]);

  // deploy outputs usage text with correct command format
  const output = result.stdout + result.stderr;
  assert.match(
    output,
    /Usage: nweb deploy/,
    "Deploy should show correct nweb deploy usage"
  );
});

test("cleanup command shows help", async () => {
  const result = await runCLI(["cleanup", "--help"]);
  assert.equal(result.code, 0, "Cleanup help should exit with code 0");
  assert.match(
    result.stdout,
    /Usage: nweb cleanup/,
    "Should use standardized nweb command format"
  );
  assert.match(result.stdout, /Cleanup/, "Cleanup help should mention cleanup");
});

test("sync command shows help", async () => {
  const result = await runCLI(["sync", "--help"]);
  assert.equal(result.code, 0, "Sync help should exit with code 0");
  assert.match(
    result.stdout,
    /Usage: nweb sync/,
    "Should use standardized nweb command format"
  );
  assert.match(result.stdout, /Sync/, "Sync help should mention sync");
});

test("versions command shows help", async () => {
  const result = await runCLI(["versions", "--help"]);
  assert.equal(result.code, 0, "Versions help should exit with code 0");
  assert.match(
    result.stdout,
    /Usage: nweb versions/,
    "Should use standardized nweb command format"
  );
  assert.match(
    result.stdout,
    /Versions/,
    "Versions help should mention versions"
  );
});

test("config command shows help", async () => {
  const result = await runCLI(["config", "--help"]);
  assert.equal(result.code, 0, "Config help should exit with code 0");
  assert.match(
    result.stdout,
    /Usage: nweb config/,
    "Should use standardized nweb command format"
  );
  assert.match(
    result.stdout,
    /Configuration/,
    "Config help should mention configuration"
  );
});

test.skip("status command shows status output (requires network)", async () => {
  // Skip: This test requires network connectivity to Nostr relays
  // and may timeout or fail in CI environments
  const result = await runCLI(["status"], {
    env: {
      NOSTR_SK_HEX:
        "0000000000000000000000000000000000000000000000000000000000000001",
    },
    timeout: 15000,
  });

  const output = result.stdout + result.stderr;
  assert.match(
    output,
    /Status Check|Identity|Relay/,
    "Should show status output"
  );
});

test("unknown command shows error", async () => {
  const result = await runCLI(["unknown-command"]);
  assert.notEqual(
    result.code,
    0,
    "Unknown command should exit with non-zero code"
  );
  assert.match(
    result.stderr,
    /Unknown command|not implemented/,
    "Should show error message"
  );
});

test("cleanup supports orphans mode", async () => {
  const result = await runCLI(["cleanup", "--help"]);
  assert.equal(result.code, 0, "Cleanup help should exit with code 0");
  assert.match(
    result.stdout,
    /--orphans.*Delete only orphaned events/,
    "Should document --orphans option"
  );
  assert.match(
    result.stdout,
    /--all.*Delete all events/,
    "Should document --all option"
  );
  assert.match(result.stdout, /--dry-run/, "Should document --dry-run option");
});
