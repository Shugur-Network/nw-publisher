# Nostr Web Publisher - Test Suite

Comprehensive testing for all nw-publish functionality.

## Test Types

### 1. Unit Tests

**Location**: `test/cli.test.mjs`, `test/relay.test.mjs`

Basic CLI and utility function tests.

```bash
npm test
```

**Coverage**:

- CLI help commands
- Command routing
- Relay URL parsing
- Basic validation

### 2. Integration Tests

**Location**: `test/integration.test.mjs`

Full end-to-end testing with real Nostr relays.

```bash
node test/integration.test.mjs
```

**Coverage**:

- Full deployment workflow
- Event publishing and verification
- Version management
- Sync functionality
- Cleanup functionality
- Config management

**Requirements**:

- Real Nostr relay connectivity
- `nak` CLI tool (optional, for event verification)
  ```bash
  go install github.com/fiatjaf/nak@latest
  ```

**What it does**:

1. ✅ Generates test keypair
2. ✅ Creates temporary test site (HTML, CSS, JS)
3. ✅ Deploys to real Nostr relays
4. ✅ Verifies events using `nak`
5. ✅ Tests version management
6. ✅ Tests sync across relays
7. ✅ Tests cleanup/deletion
8. ✅ Cleans up test data

### 3. Manual Workflow Test

**Location**: `test/manual-workflow.sh`

Interactive test script for manual verification.

```bash
./test/manual-workflow.sh
```

**What it does**:

1. 🔑 Generates test keypair
2. 📁 Creates multi-page test site
   - index.html
   - about.html
   - blog/post-1.html (nested)
   - style.css
   - app.js
3. 📦 Deploys to Nostr
4. 🔍 Verifies with `nak`
5. 📊 Checks status
6. 📚 Lists versions
7. ✏️ Modifies and republishes
8. 🔄 Tests sync
9. 🧹 Optional cleanup

**Interactive**: Prompts for cleanup at the end.

## Test Relays

Default test relays (can be changed):

- `wss://relay.nostr.band`
- `wss://nos.lol`

## Running All Tests

```bash
# Unit tests (fast)
npm test

# Integration tests (slower, uses real relays)
node test/integration.test.mjs

# Manual workflow test (interactive)
./test/manual-workflow.sh
```

## Test Coverage

| Feature            | Unit Tests | Integration Tests | Manual Tests |
| ------------------ | ---------- | ----------------- | ------------ |
| CLI help           | ✅         | -                 | ✅           |
| Deploy             | ⚠️ (basic) | ✅                | ✅           |
| Versions           | ⚠️ (basic) | ✅                | ✅           |
| Sync               | ⚠️ (basic) | ✅                | ✅           |
| Cleanup            | ⚠️ (basic) | ✅                | ✅           |
| Status             | ⚠️ (basic) | ✅                | ✅           |
| Config             | ⚠️ (basic) | ✅                | ✅           |
| Event verification | -          | ✅                | ✅           |
| Multi-page sites   | -          | ✅                | ✅           |
| Nested routes      | -          | ⚠️                | ✅           |

## Event Verification with nak

If `nak` is installed, tests will verify published events:

```bash
# Query all site events
nak req -k 1125,1126,31126,11126 -a <pubkey> <relay1> <relay2>

# Query specific kind
nak req -k 1125 -a <pubkey> wss://relay.nostr.band

# Decode npub to hex pubkey
nak decode npub1...
```

## CI/CD Integration

Unit tests run automatically on:

- Every push
- Every pull request
- Node.js 18.x, 20.x, 22.x

Integration tests are skipped in CI (require real relays).

## Test Data Cleanup

**Integration tests**: Auto-cleanup after each test
**Manual tests**: Prompts for cleanup (preserves for inspection by default)

To clean up manually:

```bash
# Remove test site directory
rm -rf test-site-*

# Delete events from relays
NOSTR_SK_HEX=<test-key> RELAYS=<relays> nw-publisher cleanup
```

## Debugging Tests

Run with verbose output:

```bash
# Integration tests with debug output
DEBUG=* node test/integration.test.mjs

# Manual test (already verbose)
./test/manual-workflow.sh
```

## Writing New Tests

### Unit Test Template

```javascript
import { test } from "node:test";
import { strict as assert } from "node:assert";

test("My test case", async () => {
  const result = await runCLI(["command", "args"]);
  assert.equal(result.code, 0, "Should succeed");
  assert.match(result.stdout, /expected/i, "Should show expected output");
});
```

### Integration Test Template

```javascript
test("My integration test", async () => {
  const testKeypair = generateTestKeypair();
  const testEnv = {
    NOSTR_SK_HEX: testKeypair.skHex,
    RELAYS: TEST_RELAYS.join(","),
  };

  createTestSite();
  const result = await runCLI(["deploy", TEST_SITE_DIR], { env: testEnv });

  assert.equal(result.code, 0);

  // Verify with nak if available
  const events = queryEventsWithNak(testKeypair.pubkey, [1125], TEST_RELAYS);
  if (events) {
    assert.ok(events.length > 0);
  }
});
```

## Known Issues

1. **Network-dependent tests**: Integration tests may fail if relays are down
2. **Event propagation delay**: Some tests wait 2-3 seconds for events to propagate
3. **Deletion propagation**: Cleanup verification may be flaky (relays don't delete instantly)
4. **Rate limiting**: Running tests frequently may trigger relay rate limits

## Contributing

When adding new features:

1. ✅ Add unit tests for utilities
2. ✅ Add integration test for full workflow
3. ✅ Update manual test if CLI changes
4. ✅ Document in this README
