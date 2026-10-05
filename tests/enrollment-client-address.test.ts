import assert from "node:assert/strict";
import test from "node:test";
import { enrollmentClientAddress } from "../src/server/enrollment-client-address.ts";

test("enrollment address trusts only explicitly configured Fly ingress", () => {
  assert.equal(
    enrollmentClientAddress("127.0.0.1", "203.0.113.2", false),
    "127.0.0.1",
  );
  assert.equal(
    enrollmentClientAddress("172.19.0.1", "203.0.113.2", true),
    "203.0.113.2",
  );
  assert.equal(
    enrollmentClientAddress("172.19.0.1", "2001:db8::1", true),
    "2001:db8::1",
  );
  for (const invalid of [
    undefined,
    "",
    "203.0.113.2, 203.0.113.3",
    ["203.0.113.2"],
    "unknown",
  ]) {
    assert.throws(
      () => enrollmentClientAddress("172.19.0.1", invalid, true),
      /temporarily unavailable/,
    );
  }
});
