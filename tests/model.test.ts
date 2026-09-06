import { expect, it } from "vitest";
import {
  checkRecovery,
  propertiesFor,
  sourceFingerprint,
  newMeta,
  readMeta,
} from "../src/model";
it("refuses expired and changed-token retry requests", () => {
  const pending = { created: 1000, scope: "a" };
  expect(() => checkRecovery(pending, "a", 2000)).not.toThrow();
  expect(() => checkRecovery(pending, "b", 2000)).toThrow(
    "connection or token changed",
  );
  expect(() => checkRecovery(pending, "a", 1000 + 23 * 3600_000)).toThrow(
    "window",
  );
});
it("hashes source consistently regardless of property insertion order", async () => {
  expect(await sourceFingerprint({ name: ["Title"], content: ["Body"] })).toBe(
    await sourceFingerprint({ content: ["Body"], name: ["Title"] }),
  );
});
it("matches OnceMarked field limits before sending", () => {
  expect(() =>
    propertiesFor("Title", "a".repeat(81), [], "draft", "Body"),
  ).toThrow("80");
  expect(() =>
    propertiesFor("Title", "slug", ["a".repeat(33)], "draft", "Body"),
  ).toThrow("32");
  expect(() => propertiesFor("Title", "slug", [], "unknown", "Body")).toThrow();
});
it("clones note metadata and rejects malformed recovery data", () => {
  const meta = newMeta();
  expect(readMeta(meta)).toEqual(meta);
  expect(readMeta(meta)).not.toBe(meta);
  expect(() => readMeta({ ...meta, pending: { blog: {} } })).toThrow(
    "recovery",
  );
});
