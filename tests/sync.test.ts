import { describe, expect, it } from "vitest";
import { hasConflictMarkers, mergeMarkdown, twoWayConflict } from "../src/sync";

describe("manual sync merge", () => {
  it("combines independent edits without markers", () => {
    const base = "# Title\n\nFirst paragraph.\n\nSecond paragraph.\n";
    const local = "# Better title\n\nFirst paragraph.\n\nSecond paragraph.\n";
    const remote = "# Title\n\nFirst paragraph.\n\nA changed ending.\n";
    expect(mergeMarkdown(base, local, remote)).toEqual({
      markdown: "# Better title\n\nFirst paragraph.\n\nA changed ending.\n",
      conflicts: 0,
    });
  });

  it("puts overlapping candidates in the note", () => {
    const result = mergeMarkdown(
      "Before\nShared line\nAfter\n",
      "Before\nLocal wording\nAfter\n",
      "Before\nRemote wording\nAfter\n",
    );
    expect(result.conflicts).toBe(1);
    expect(result.markdown).toContain(
      "<<<<<<< Obsidian\nLocal wording\n=======\nRemote wording\n>>>>>>> OnceMarked",
    );
    expect(hasConflictMarkers(result.markdown)).toBe(true);
  });

  it("merges identical changes once", () => {
    expect(mergeMarkdown("A\nB\n", "A\nC\n", "A\nC\n")).toEqual({
      markdown: "A\nC\n",
      conflicts: 0,
    });
  });

  it("merges insertions at different positions", () => {
    expect(mergeMarkdown("A\nB\n", "Local\nA\nB\n", "A\nB\nRemote\n")).toEqual({
      markdown: "Local\nA\nB\nRemote\n",
      conflicts: 0,
    });
  });

  it("marks different insertions at the same position", () => {
    const result = mergeMarkdown("A\n", "Local\nA\n", "Remote\nA\n");
    expect(result.conflicts).toBe(1);
    expect(result.markdown).toContain("Local\n=======\nRemote");
  });

  it("falls back to complete candidates without a common snapshot", () => {
    const result = twoWayConflict("Local\n", "Remote\n");
    expect(result.conflicts).toBe(1);
    expect(result.markdown).toBe(
      "<<<<<<< Obsidian\nLocal\n=======\nRemote\n>>>>>>> OnceMarked\n",
    );
  });
});
