import { describe, expect, it } from "vitest";
import { IdentityIndex } from "../src/identity";

describe("durable identity index", () => {
  it("preserves identity across move, delete and restore to another path", () => {
    const index = new IdentityIndex();
    index.observe({ id: "note-a", path: "draft.md" });
    index.move("draft.md", "Archive/renamed.md");
    expect(index.locate("note-a")).toBe("Archive/renamed.md");
    index.remove("Archive/renamed.md");
    expect(index.locate("note-a")).toBeNull();
    expect(index.history("note-a")).toContain("draft.md");
    index.observe({ id: "note-a", path: "Restored.md" });
    expect(index.locate("note-a")).toBe("Restored.md");
  });
  it("rebuilds after offline moves without relying on previous filenames", () => {
    const index = new IdentityIndex();
    index.observe({ id: "a", path: "before.md" });
    index.rebuild([{ id: "a", path: "after.md" }]);
    expect(index.locate("a")).toBe("after.md");
  });
  it("blocks duplicate identities until explicitly resolved", () => {
    const index = new IdentityIndex();
    index.rebuild([
      { id: "a", path: "one.md" },
      { id: "a", path: "copy.md" },
    ]);
    expect(() => index.locate("a")).toThrow("Duplicate");
    index.observe({ id: "b", path: "copy.md" });
    expect(index.locate("a")).toBe("one.md");
    expect(index.locate("b")).toBe("copy.md");
  });
  it("does not overwrite an occupied destination", () => {
    const index = new IdentityIndex();
    index.rebuild([
      { id: "a", path: "a.md" },
      { id: "b", path: "b.md" },
    ]);
    expect(() => index.move("a.md", "b.md")).toThrow("already tracked");
    expect(index.locate("a")).toBe("a.md");
  });
});
