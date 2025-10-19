import { test } from "node:test";
import { strict as assert } from "node:assert";
import { parseRelayUrls } from "../src/lib/relay.mjs";

test("parseRelayUrls handles string input", () => {
  const input = "wss://relay.example.com,wss://relay2.example.com";
  const result = parseRelayUrls(input);

  assert.ok(Array.isArray(result), "Should return an array");
  assert.equal(result.length, 2, "Should parse 2 relays");
  assert.equal(result[0], "wss://relay.example.com");
  assert.equal(result[1], "wss://relay2.example.com");
});

test("parseRelayUrls handles array input", () => {
  const input = ["wss://relay1.com", "wss://relay2.com"];
  const result = parseRelayUrls(input);

  assert.ok(Array.isArray(result), "Should return an array");
  assert.equal(result.length, 2, "Should return 2 relays");
  assert.equal(result[0], "wss://relay1.com");
});

test("parseRelayUrls trims whitespace", () => {
  const input = " wss://relay.com , wss://relay2.com ";
  const result = parseRelayUrls(input);

  assert.equal(result[0], "wss://relay.com", "Should trim whitespace");
  assert.equal(result[1], "wss://relay2.com", "Should trim whitespace");
});

test("parseRelayUrls filters empty entries", () => {
  const input = "wss://relay.com,  ,wss://relay2.com";
  const result = parseRelayUrls(input);

  assert.equal(result.length, 2, "Should filter empty entries");
});

test("parseRelayUrls validates wss:// protocol", () => {
  const input = "wss://valid.com,http://invalid.com,ws://also-valid.com";
  const result = parseRelayUrls(input);

  // Should only include ws:// or wss://
  assert.ok(
    result.every((url) => url.startsWith("ws://") || url.startsWith("wss://")),
    "All relays should use ws:// or wss:// protocol"
  );
});
