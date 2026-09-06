import { describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import type { App, TFile as ObsidianFile } from "obsidian";
import { TFile, getFrontMatterInfo, parseYaml } from "./obsidian-mock";
import { NoteRepository } from "../src/repository";
import { Publisher, type PublishInput } from "../src/publisher";
import { defaultSettings, type SavedData } from "../src/model";
import {
  MicropubClient,
  type HttpRequest,
  type HttpResponse,
  type Properties,
} from "../src/micropub";
vi.mock("../src/images", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/images")>()),
  optimiseImage: async (bytes: ArrayBuffer) => ({ bytes, mime: "image/png" }),
}));
const input: PublishInput = {
  title: "My post",
  slug: "my-post",
  tags: ["Notes"],
  state: "draft",
  plainUnpublished: false,
};
function harness() {
  const file = new TFile("Note.md");
  const files = [file];
  const contents = new Map([[file.path, "# Hello\n\nBody."]]);
  const binary = new Uint8Array(24);
  binary.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const binaryView = new DataView(binary.buffer);
  binaryView.setUint32(16, 10);
  binaryView.setUint32(20, 10);
  const app = {
    vault: {
      getMarkdownFiles: () => files.filter((f) => f.extension === "md"),
      read: async (f: TFile) => {
        if (!contents.has(f.path)) throw new Error("Missing file");
        return contents.get(f.path)!;
      },
      readBinary: async () => binary.buffer,
    },
    fileManager: {
      processFrontMatter: async (
        f: TFile,
        update: (properties: Record<string, unknown>) => void,
      ) => {
        const source = contents.get(f.path)!;
        const info = getFrontMatterInfo(source);
        const properties = info.exists ? parseYaml(info.frontmatter) : {};
        update(properties);
        contents.set(
          f.path,
          `---\n${stringify(properties)}---\n${source.slice(info.contentStart)}`,
        );
      },
    },
    metadataCache: {
      getFirstLinkpathDest: (path: string) =>
        files.find((f) => f.path === path || f.basename === path),
    },
  } as unknown as App;
  const data: SavedData = {
    settings: defaultSettings(),
    media: {},
    history: {},
  };
  data.settings.images.enabled = false;
  const blog = {
    id: "blog",
    name: "Test",
    endpoint: "https://oncemarked.com/micropub",
    tokenName: "secret",
  };
  data.settings.blogs = [blog];
  const save = vi.fn(async () => {});
  const notes = new NoteRepository(app, data, save);
  let remote: Properties = {};
  let loseResponse = false;
  let creates = 0,
    updates = 0,
    uploads = 0;
  const replays = new Map<string, HttpResponse>();
  const transport = vi.fn(
    async (request: HttpRequest): Promise<HttpResponse> => {
      const response = (
        status: number,
        body: unknown = {},
        headers: Record<string, string> = {},
      ) => ({ status, text: JSON.stringify(body), headers });
      const url = new URL(request.url);
      if (request.method === "GET")
        return url.searchParams.get("q") === "config"
          ? response(200, {
              "media-endpoint": "/micropub/media",
              oncemarked: {
                imageOptions: {
                  sizes: [640, 960, 1600, 1920, 2560, 3840, 7680],
                  minQuality: 60,
                  maxQuality: 95,
                },
              },
            })
          : response(200, { properties: remote });
      const key = request.headers["Idempotency-Key"]!;
      if (replays.has(key)) return replays.get(key)!;
      let result: HttpResponse;
      if (url.pathname.endsWith("/media")) {
        uploads++;
        result = response(
          201,
          {},
          {
            Location:
              "https://author.example/__media/12345678-1234-4123-8123-123456789012.webp",
          },
        );
      } else {
        const body = JSON.parse(request.body as string) as {
          action?: string;
          replace?: Properties;
          properties?: Properties;
        };
        if (body.action === "update") {
          updates++;
          remote = { ...remote, ...body.replace };
        } else {
          creates++;
          remote = body.properties!;
        }
        const published = remote["post-status"]?.[0] === "published";
        result = response(
          body.action === "update" && !published ? 204 : 201,
          {},
          {
            Location: published
              ? "https://author.example/my-post"
              : "https://oncemarked.com/blogs/entries/post?blog=blog",
          },
        );
      }
      replays.set(key, result);
      if (loseResponse) {
        loseResponse = false;
        throw new Error("Lost response");
      }
      return result;
    },
  );
  const client = new MicropubClient(blog.endpoint, "token", transport);
  const publisher = new Publisher(notes, data, save, () => ({
    client,
    token: "token",
  }));
  return {
    file: file as unknown as ObsidianFile,
    files,
    contents,
    data,
    notes,
    publisher,
    blog,
    transport,
    save,
    remote: () => remote,
    setRemote: (value: Properties) => {
      remote = value;
    },
    lose: () => {
      loseResponse = true;
    },
    counts: () => ({ creates, updates, uploads }),
  };
}
describe("publishing lifecycle", () => {
  it("persists identity, creates a draft, publishes it, and retains the changed URL", async () => {
    const h = harness();
    const review = await h.publisher.review(h.file, h.blog, input);
    expect(h.counts().creates).toBe(0);
    expect((await h.notes.read(h.file)).meta?.id).toBe(review.noteId);
    await h.publisher.publish(h.file, h.blog, review, false, () => {});
    const next = await h.publisher.review(h.file, h.blog, {
      ...input,
      state: "published",
    });
    expect(next.conflict).toBe(false);
    expect(
      await h.publisher.publish(h.file, h.blog, next, false, () => {}),
    ).toBe("https://author.example/my-post");
    expect((await h.notes.read(h.file)).meta?.posts.blog?.url).toBe(
      "https://author.example/my-post",
    );
    expect(h.counts()).toEqual({ creates: 1, updates: 1, uploads: 0 });
  });
  it("recovers a lost response with the same key and no second creation", async () => {
    const h = harness();
    const review = await h.publisher.review(h.file, h.blog, input);
    h.lose();
    await expect(
      h.publisher.publish(h.file, h.blog, review, false, () => {}),
    ).rejects.toThrow("Lost response");
    const pending = (await h.notes.read(h.file)).meta?.pending.blog;
    expect(pending?.key).toBeTruthy();
    await expect(h.publisher.review(h.file, h.blog, input)).rejects.toThrow(
      "recovery",
    );
    await h.publisher.recover(h.file, h.blog);
    expect(h.counts().creates).toBe(1);
    expect((await h.notes.read(h.file)).meta?.pending.blog).toBeUndefined();
    const posts = h.transport.mock.calls.filter(([r]) => r.method === "POST");
    expect(posts[0]?.[0].headers["Idempotency-Key"]).toBe(
      posts[1]?.[0].headers["Idempotency-Key"],
    );
  });
  it("does not resend an expired pending write", async () => {
    const h = harness();
    const review = await h.publisher.review(h.file, h.blog, input);
    h.lose();
    await expect(
      h.publisher.publish(h.file, h.blog, review, false, () => {}),
    ).rejects.toThrow();
    await h.notes.mutate(h.file, review.noteId, (meta) => {
      meta.pending.blog!.created = Date.now() - 24 * 3600_000;
    });
    await expect(h.publisher.recover(h.file, h.blog)).rejects.toThrow("window");
    expect(h.counts().creates).toBe(1);
  });
  it("blocks local edits after review before a remote write", async () => {
    const h = harness();
    const review = await h.publisher.review(h.file, h.blog, input);
    h.contents.set(
      h.file.path,
      h.contents.get(h.file.path)! + "\nNew paragraph",
    );
    await expect(
      h.publisher.publish(h.file, h.blog, review, false, () => {}),
    ).rejects.toThrow("note changed");
    expect(h.counts().creates).toBe(0);
  });
  it("requires explicit overwrite and rechecks remote changes after review", async () => {
    const h = harness();
    await h.publisher.publish(
      h.file,
      h.blog,
      await h.publisher.review(h.file, h.blog, input),
      false,
      () => {},
    );
    h.setRemote({ ...h.remote(), content: ["Edited on web"] });
    const review = await h.publisher.review(h.file, h.blog, input);
    expect(review.conflict).toBe(true);
    await expect(
      h.publisher.publish(h.file, h.blog, review, false, () => {}),
    ).rejects.toThrow("remote changes");
    h.setRemote({ ...h.remote(), content: ["Edited again"] });
    await expect(
      h.publisher.publish(h.file, h.blog, review, true, () => {}),
    ).rejects.toThrow("remote post changed");
    expect(h.counts().updates).toBe(0);
  });
  it("uploads repeated images once and reuses them on the next edit", async () => {
    const h = harness();
    const image = new TFile("photo.png");
    h.files.push(image);
    h.contents.set(
      h.file.path,
      "Hello\n\n![[photo.png]]\n\n![Again](photo.png)",
    );
    await h.publisher.publish(
      h.file,
      h.blog,
      await h.publisher.review(h.file, h.blog, input),
      false,
      () => {},
    );
    const markdown = String(h.remote().content?.[0]);
    expect(
      markdown.match(/12345678-1234-4123-8123-123456789012/g),
    ).toHaveLength(2);
    expect(h.counts().uploads).toBe(1);
    await h.publisher.publish(
      h.file,
      h.blog,
      await h.publisher.review(h.file, h.blog, input),
      false,
      () => {},
    );
    expect(h.counts().uploads).toBe(1);
    expect(h.contents.get(h.file.path)).toContain("![[photo.png]]");
  });
  it("refuses copied identities and reconnects a moved/restored file", async () => {
    const h = harness();
    const review = await h.publisher.review(h.file, h.blog, input);
    const copy = new TFile("Copy.md");
    h.files.push(copy);
    h.contents.set(copy.path, h.contents.get(h.file.path)!);
    await expect(
      h.publisher.publish(h.file, h.blog, review, false, () => {}),
    ).rejects.toThrow("shares a OnceMarked ID");
    h.files.pop();
    h.contents.delete(copy.path);
    const source = h.contents.get(h.file.path)!;
    h.contents.delete(h.file.path);
    h.file.path = "Archive/Renamed.md";
    h.contents.set(h.file.path, source);
    expect((await h.publisher.review(h.file, h.blog, input)).noteId).toBe(
      review.noteId,
    );
  });
  it("finds a previously unpublished dependency after publication", async () => {
    const h = harness();
    const target = new TFile("Target.md");
    h.files.push(target);
    h.contents.set(target.path, "Target body");
    h.contents.set(h.file.path, "Read [[Target]]");
    await h.publisher.publish(
      h.file,
      h.blog,
      await h.publisher.review(h.file, h.blog, {
        ...input,
        plainUnpublished: true,
      }),
      false,
      () => {},
    );
    const targetMeta = await h.notes.ensure(target as unknown as ObsidianFile);
    expect(await h.publisher.affected(targetMeta.id, h.blog.id)).toEqual([
      h.file,
    ]);
  });
  it("does not write remotely when durable request persistence fails", async () => {
    const h = harness();
    const review = await h.publisher.review(h.file, h.blog, input);
    h.save.mockRejectedValueOnce(new Error("Disk full"));
    await expect(
      h.publisher.publish(h.file, h.blog, review, false, () => {}),
    ).rejects.toThrow("Disk full");
    expect(h.counts().creates).toBe(0);
  });
  it("relinks without a remote mutation and requires a conflict review before replacing", async () => {
    const h = harness();
    h.setRemote({
      name: ["Existing"],
      content: ["Written elsewhere"],
      "post-status": ["published"],
      "mp-slug": ["existing"],
      category: [],
    });
    await h.publisher.relink(h.file, h.blog, "https://author.example/existing");
    expect(h.counts()).toEqual({ creates: 0, updates: 0, uploads: 0 });
    const review = await h.publisher.review(h.file, h.blog, input);
    expect(review.conflict).toBe(true);
    expect((await h.notes.read(h.file)).meta?.lastBlog).toBe(h.blog.id);
  });
  it("keeps the exact failed image request when optimisation settings change", async () => {
    const h = harness();
    h.files.push(new TFile("photo.png"));
    h.contents.set(h.file.path, "Image\n\n![[photo.png]]");
    const review = await h.publisher.review(h.file, h.blog, input);
    h.lose();
    await expect(
      h.publisher.publish(h.file, h.blog, review, false, () => {}),
    ).rejects.toThrow("Lost response");
    expect(h.counts().uploads).toBe(1);
    h.data.settings.images.quality = 0.5;
    await h.publisher.publish(
      h.file,
      h.blog,
      await h.publisher.review(h.file, h.blog, input),
      false,
      () => {},
    );
    expect(h.counts().uploads).toBe(1);
    expect(h.counts().creates).toBe(1);
  });
});
