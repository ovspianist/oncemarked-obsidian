import { describe, expect, it, vi } from "vitest";
import {
  prepareMarkdown,
  replaceImagePaths,
  headingFragment,
  variableTrigger,
} from "../src/markdown";
const publicNote = {
  id: "a",
  url: "https://author.example/article",
  state: "published",
  markdown: "# Hello **world**\n\n## Café 東京\n\n## Café 東京",
};
const setup = () => ({
  resolve: vi.fn(async () => publicNote),
  image: vi.fn(
    async () => "/__media/12345678-1234-4123-8123-123456789012.webp",
  ),
  plainUnpublished: false,
});
describe("Markdown publication", () => {
  it("converts wiki and Markdown note links while preserving aliases and headings", async () => {
    const options = setup();
    const result = await prepareMarkdown(
      "[[Note|An article]] and [heading](Note.md#Hello%20world) and [[Note#Café 東京]]",
      options,
    );
    expect(result.issues).toEqual([]);
    expect(result.markdown).toContain(
      "[An article](https://author.example/article)",
    );
    expect(result.markdown).toContain("#section-hello-world");
    expect(result.markdown).toContain("#section-café-東京");
    expect(result.dependencies).toEqual(["a"]);
  });
  it("removes all properties and private comments but preserves code literally", async () => {
    const options = setup();
    const result = await prepareMarkdown(
      "---\nsecret: private\n---\n\nHello %% never publish %%there.\n\n`%% [[Secret]]`\n\n%% another secret %%\n\n```md\n[[Code]]\n```",
      options,
    );
    expect(result.markdown).not.toContain("never publish");
    expect(result.markdown).not.toContain("another secret");
    expect(result.markdown).not.toContain("secret:");
    expect(result.markdown).toContain("`%% [[Secret]]`");
    expect(result.markdown).toContain("[[Code]]");
    expect(options.resolve).not.toHaveBeenCalled();
  });
  it("retains ordinary external-link emphasis and code", async () => {
    const result = await prepareMarkdown(
      '[**Bold** `label`](https://example.com/path "Title")',
      setup(),
    );
    expect(result.markdown).toBe(
      '[**Bold** `label`](https://example.com/path "Title")',
    );
  });
  it("blocks missing, unpublished, block and unsafe links", async () => {
    const options = { ...setup(), resolve: async () => undefined };
    const result = await prepareMarkdown(
      "[[Missing]] [[Note#^block]] [bad](obsidian://open) [draft](https://oncemarked.com/blogs/entries/a)",
      options,
    );
    expect(result.issues).toHaveLength(4);
    expect(result.markdown).not.toContain("obsidian://");
    expect(result.markdown).not.toContain("/blogs/entries");
  });
  it("only permits explicit plain-text fallback for missing/unpublished notes", async () => {
    const result = await prepareMarkdown("[[Draft|Read later]]", {
      ...setup(),
      resolve: async () => ({ ...publicNote, state: "draft" }),
      plainUnpublished: true,
    });
    expect(result.markdown).toBe("Read later");
    expect(result.dependencies).toEqual(["a"]);
    expect(result.issues).toEqual([]);
  });
  it("resolves images and reference links without leaving private definitions", async () => {
    const options = setup();
    const result = await prepareMarkdown(
      "![[pic.png|400]]\n\n![Alt][image]\n\n[Read][note]\n\n[image]: pic.png\n[note]: Note.md",
      options,
    );
    expect(result.issues).toEqual([]);
    expect(result.markdown).toContain("![pic.png](/__media/");
    expect(result.markdown).toContain("![Alt](/__media/");
    expect(result.markdown).not.toContain("[image]:");
    expect(result.markdown).toContain("[Read](https://author.example/article)");
  });
  it("replaces only image nodes, including repeats and mixed hosted images", () => {
    const source =
      "![a](/placeholder)\n![b](/hosted)\n![again](/placeholder)\n`![code](/placeholder)`";
    expect(
      replaceImagePaths(source, new Map([["/placeholder", "/uploaded"]])),
    ).toBe(
      "![a](/uploaded)\n![b](/hosted)\n![again](/uploaded)\n`![code](/placeholder)`",
    );
  });
  it("supports Unicode and duplicate heading IDs", () => {
    expect(headingFragment(publicNote.markdown, "Café 東京")).toBe(
      "section-café-東京",
    );
    expect(headingFragment(publicNote.markdown, "section-café-東京-2")).toBe(
      "section-café-東京-2",
    );
  });
  it("does not publish unsupported HTML", async () => {
    expect(
      (await prepareMarkdown("<script>secret()</script>", setup())).issues
        .length,
    ).toBeGreaterThan(0);
  });
});
describe("variable suggestion context", () => {
  it("triggers after opening braces and partial names", () => {
    expect(variableTrigger("Hello {{ aut", 12)).toEqual({
      start: 6,
      query: "aut",
    });
  });
  it.each([
    "`{{ au`",
    "```\n{{ au\n```",
    "\\{{ au",
    "%% {{ au",
    "---\ntitle: {{ au\n---",
    "[{{ au](https://example.com)",
  ])("skips protected context %s", (source) => {
    const offset = source.indexOf("au") + 2;
    expect(variableTrigger(source, offset)).toBeNull();
  });
});

it("does not suggest inside unfinished inline code and ignores comments inside code", () => {
  expect(variableTrigger("`{{ au", 6)).toBeNull();
  expect(variableTrigger("`%%` {{ au", 10)).toEqual({ start: 5, query: "au" });
});
it("converts wiki aliases containing Markdown punctuation", async () => {
  const result = await prepareMarkdown("[[Note|An *article*]]", setup());
  expect(result.markdown).toBe(
    "[An \\*article\\*](https://author.example/article)",
  );
});
