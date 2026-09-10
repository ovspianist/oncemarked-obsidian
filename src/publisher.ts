import type { TFile } from "obsidian";
import { NoteRepository } from "./repository";
import { MicropubClient, MicropubError, type Properties } from "./micropub";
import {
  prepareMarkdown,
  replaceImagePaths,
  mapImagePaths,
  decodePath,
  type LinkTarget,
  type PreparedMarkdown,
} from "./markdown";
import {
  checkRecovery,
  digest,
  propertiesFor,
  sourceFingerprint,
  type BlogConnection,
  type SavedData,
  type Binding,
  syncKey,
} from "./model";
import {
  fromBase64,
  mediaPath,
  optimiseImage,
  toBase64,
  MAX_IMAGE_BYTES,
} from "./images";
import { noteBody } from "./repository";
import { hasConflictMarkers, mergeMarkdown, twoWayConflict } from "./sync";
export interface PublishInput {
  title: string;
  slug: string;
  tags: string[];
  state: "draft" | "published";
  plainUnpublished: boolean;
}
export interface Review {
  source: string;
  noteId: string;
  prepared: PreparedMarkdown;
  images: Map<string, TFile>;
  placeholders: Map<string, string>;
  remote?: Properties;
  fingerprint?: string;
  conflict: boolean;
  input: PublishInput;
  blogId: string;
}
export type SyncState =
  "up-to-date" | "local-ahead" | "remote-ahead" | "merged" | "conflict";
export interface SyncReview {
  source: string;
  noteId: string;
  blogId: string;
  remote: Properties;
  remoteFingerprint: string;
  remoteBody: string;
  markdown: string;
  conflicts: number;
  state: SyncState;
  legacy: boolean;
  metadataChanged: boolean;
}
const textProperty = (data: Properties, key: string): string =>
  typeof data[key]?.[0] === "string" ? data[key][0] : "";

const mediaPattern =
  /^\/__media\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\.webp$/i;

function mediaBase(source: Properties, binding: Binding): string | undefined {
  const explicit = textProperty(source, "oncemarked-mediaBase");
  if (explicit) return new URL(explicit).origin;
  const current = textProperty(source, "oncemarked-url") || binding.url;
  const address = new URL(current);
  return address.hostname === "oncemarked.com" &&
    address.pathname.startsWith("/blogs/entries/")
    ? undefined
    : address.origin;
}

function remoteBody(source: Properties, binding: Binding): string {
  const base = mediaBase(source, binding);
  return mapImagePaths(textProperty(source, "content"), (path) =>
    base && mediaPattern.test(path) ? base + path : path,
  );
}

function remoteMetadataChanged(source: Properties, binding: Binding): boolean {
  const tags = (source.category ?? []).filter(
    (value): value is string => typeof value === "string",
  );
  return (
    textProperty(source, "name") !== (binding.title ?? "") ||
    textProperty(source, "mp-slug") !== (binding.slug ?? "") ||
    textProperty(source, "post-status") !== binding.state ||
    JSON.stringify(tags) !== JSON.stringify(binding.tags ?? []) ||
    (textProperty(source, "oncemarked-url") || binding.url) !== binding.url
  );
}

function refreshBinding(
  binding: Binding,
  source: Properties,
  baseline: string,
): void {
  const state = textProperty(source, "post-status");
  if (state !== "draft" && state !== "published")
    throw new Error("The remote post returned an unknown publication state.");
  binding.url = textProperty(source, "oncemarked-url") || binding.url;
  binding.sourceUrl =
    textProperty(source, "oncemarked-sourceUrl") || binding.sourceUrl;
  binding.state = state;
  binding.baseline = baseline;
  binding.tags = (source.category ?? []).filter(
    (value): value is string => typeof value === "string",
  );
  binding.title = textProperty(source, "name");
  binding.slug = textProperty(source, "mp-slug");
}

export class Publisher {
  private readonly busy = new Set<string>();
  constructor(
    readonly notes: NoteRepository,
    private readonly data: SavedData,
    private readonly save: () => Promise<void>,
    private readonly connect: (blog: BlogConnection) => {
      client: MicropubClient;
      token: string;
    },
  ) {}
  private async locked<T>(
    file: TFile,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.busy.has(file.path))
      throw new Error("This note already has an operation in progress.");
    const path = file.path;
    this.busy.add(path);
    try {
      return await operation();
    } finally {
      this.busy.delete(path);
    }
  }
  async review(
    file: TFile,
    blog: BlogConnection,
    input: PublishInput,
  ): Promise<Review> {
    return this.locked(file, async () => {
      const meta = await this.notes.ensure(file);
      if (meta.pending[blog.id])
        throw new Error(
          "A previous request needs recovery. Use “Recover pending request” first.",
        );
      const { source } = await this.notes.read(file);
      if (
        this.data.syncRecoveries?.[syncKey(meta.id, blog.id)] &&
        hasConflictMarkers(noteBody(source))
      )
        throw new Error(
          "Resolve all OnceMarked conflict markers before publishing.",
        );
      const { client } = this.connect(blog);
      const binding = meta.posts[blog.id];
      const remote = binding
        ? await client.source(binding.sourceUrl ?? binding.url)
        : undefined;
      const fingerprint = remote ? await sourceFingerprint(remote) : undefined;
      const images = new Map<string, TFile>();
      const placeholders = new Map<string, string>();
      const targets = new Map<string, Promise<LinkTarget | undefined>>();
      const prepared = await prepareMarkdown(source, {
        plainUnpublished: input.plainUnpublished,
        resolve: (path) => {
          if (!targets.has(path))
            targets.set(
              path,
              (async () => {
                const target = this.notes.resolve(path, file);
                if (!target || target.extension !== "md") return undefined;
                const { meta: linked } = await this.notes.read(target);
                if (!linked)
                  return {
                    id: `path:${target.path}`,
                    url: "",
                    state: "draft",
                    markdown: "",
                  };
                await this.notes.assertUnique(target, linked.id);
                let destination = blog;
                let post = linked.posts[blog.id];
                if (!post) {
                  const candidates = this.data.settings.blogs.filter(
                    (candidate) =>
                      linked.posts[candidate.id]?.state === "published",
                  );
                  if (candidates.length > 1)
                    throw new Error(
                      `“${target.basename}” is published to multiple blogs. Use an explicit public URL to choose the destination.`,
                    );
                  if (candidates[0]) {
                    destination = candidates[0];
                    post = linked.posts[destination.id];
                  }
                }
                if (!post)
                  return {
                    id: linked.id,
                    url: "",
                    state: "draft",
                    markdown: "",
                  };
                const targetClient =
                  destination.id === blog.id
                    ? client
                    : this.connect(destination).client;
                const current = await targetClient.source(
                  post.sourceUrl ?? post.url,
                );
                const state = textProperty(current, "post-status");
                const url = textProperty(current, "oncemarked-url") || post.url;
                if (
                  state === "published" &&
                  new URL(url).pathname.startsWith("/blogs/entries/")
                )
                  throw new Error(
                    `Relink “${target.basename}” to its public address before linking to it.`,
                  );
                return {
                  id: linked.id,
                  url,
                  state,
                  markdown: textProperty(current, "content"),
                };
              })(),
            );
          return targets.get(path)!;
        },
        image: async (path) => {
          if (/^\/__media\/[a-f\d-]+\.webp$/i.test(path)) return path;
          if (/^https?:/i.test(path) && binding && remote) {
            const address = new URL(path);
            const base = mediaBase(remote, binding);
            if (
              base === address.origin &&
              mediaPattern.test(address.pathname) &&
              !address.search &&
              !address.hash
            )
              return address.pathname;
          }
          if (/^[a-z][\w+.-]*:|^\/\//i.test(path))
            throw new Error(
              "External images must be saved in your vault before publishing.",
            );
          const target = this.notes.resolve(decodePath(path), file);
          if (
            !target ||
            !["jpg", "jpeg", "png", "webp"].includes(
              target.extension.toLowerCase(),
            )
          )
            throw new Error(
              `Missing or unsupported image: ${path}. Use JPEG, PNG or WebP.`,
            );
          if (target.stat.size > MAX_IMAGE_BYTES)
            throw new Error(`Image exceeds 12 MiB: ${path}`);
          if (!images.has(path) && images.size >= 30)
            throw new Error("Use at most 30 local images per post.");
          images.set(path, target);
          if (!placeholders.has(path))
            placeholders.set(path, `/__media/${crypto.randomUUID()}.webp`);
          return placeholders.get(path)!;
        },
      });
      propertiesFor(
        input.title,
        input.slug,
        input.tags,
        input.state,
        prepared.markdown,
      );
      return {
        source,
        noteId: meta.id,
        prepared,
        images,
        placeholders,
        remote,
        fingerprint,
        conflict: !!binding && fingerprint !== binding.baseline,
        input: structuredClone(input),
        blogId: blog.id,
      };
    });
  }
  async syncReview(file: TFile, blog: BlogConnection): Promise<SyncReview> {
    return this.locked(file, async () => {
      const current = await this.notes.read(file);
      const meta = current.meta;
      const binding = meta?.posts[blog.id];
      if (!meta || !binding)
        throw new Error("This note is not linked to the selected blog.");
      await this.notes.assertUnique(file, meta.id);
      if (meta.pending[blog.id])
        throw new Error(
          "A previous request needs recovery before this note can sync.",
        );
      if (this.data.syncRecoveries?.[syncKey(meta.id, blog.id)])
        throw new Error(
          "This note already has an unresolved sync. Resolve and publish it, or restore the pre-sync note.",
        );
      const remote = await this.connect(blog).client.source(
        binding.sourceUrl ?? binding.url,
      );
      const remoteFingerprint = await sourceFingerprint(remote);
      const local = noteBody(current.source);
      const fromRemote = remoteBody(remote, binding);
      const key = syncKey(meta.id, blog.id);
      const snapshot = this.data.syncSnapshots?.[key];
      const usableSnapshot =
        snapshot && snapshot.fingerprint === binding.baseline
          ? snapshot
          : undefined;
      const remoteChanged = remoteFingerprint !== binding.baseline;
      const localChanged = usableSnapshot
        ? (await digest(local)) !== usableSnapshot.localFingerprint
        : local !== fromRemote;
      let state: SyncState;
      let markdown = local;
      let conflicts = 0;
      if (!remoteChanged) state = localChanged ? "local-ahead" : "up-to-date";
      else if (usableSnapshot) {
        if (fromRemote === usableSnapshot.remote) {
          state = localChanged ? "merged" : "remote-ahead";
        } else {
          const merged = mergeMarkdown(
            usableSnapshot.remote,
            local,
            fromRemote,
          );
          markdown = merged.markdown;
          conflicts = merged.conflicts;
          state = conflicts
            ? "conflict"
            : localChanged
              ? "merged"
              : "remote-ahead";
        }
      } else if (!localChanged) {
        state = "remote-ahead";
        markdown = fromRemote;
      } else {
        const merged = twoWayConflict(local, fromRemote);
        markdown = merged.markdown;
        conflicts = merged.conflicts;
        state = conflicts ? "conflict" : "merged";
      }
      return {
        source: current.source,
        noteId: meta.id,
        blogId: blog.id,
        remote,
        remoteFingerprint,
        remoteBody: fromRemote,
        markdown,
        conflicts,
        state,
        legacy: !usableSnapshot,
        metadataChanged: remoteMetadataChanged(remote, binding),
      };
    });
  }
  async applySync(
    file: TFile,
    blog: BlogConnection,
    review: SyncReview,
  ): Promise<void> {
    return this.locked(file, async () => {
      if (review.blogId !== blog.id)
        throw new Error("Sync destination changed. Review again.");
      const current = await this.notes.read(file);
      const binding = current.meta?.posts[blog.id];
      if (
        current.source !== review.source ||
        current.meta?.id !== review.noteId ||
        !binding
      )
        throw new Error("The note changed after sync review. Review again.");
      const remote = await this.connect(blog).client.source(
        binding.sourceUrl ?? binding.url,
      );
      if ((await sourceFingerprint(remote)) !== review.remoteFingerprint)
        throw new Error(
          "The OnceMarked post changed after sync review. Review again.",
        );
      const key = syncKey(review.noteId, blog.id);
      this.data.syncRecoveries ??= {};
      this.data.syncSnapshots ??= {};
      const writesBody = review.markdown !== noteBody(current.source);
      if (writesBody) {
        this.data.syncRecoveries[key] = {
          created: Date.now(),
          source: current.source,
          snapshot: this.data.syncSnapshots[key]
            ? structuredClone(this.data.syncSnapshots[key])
            : undefined,
        };
        await this.save();
        await this.notes.replaceBody(file, current.source, review.markdown);
      }
      await this.notes.mutate(file, review.noteId, (note) => {
        const post = note.posts[blog.id];
        if (!post) throw new Error("The post association changed.");
        refreshBinding(post, remote, review.remoteFingerprint);
        note.lastBlog = blog.id;
      });
      this.data.syncSnapshots[key] = {
        localFingerprint: await digest(
          ["merged", "conflict", "local-ahead"].includes(review.state)
            ? review.remoteBody
            : review.markdown,
        ),
        remote: review.remoteBody,
        fingerprint: review.remoteFingerprint,
      };
      if (!writesBody || ["remote-ahead", "up-to-date"].includes(review.state))
        delete this.data.syncRecoveries[key];
      await this.save();
    });
  }
  async restoreBeforeSync(file: TFile, blog: BlogConnection): Promise<void> {
    return this.locked(file, async () => {
      const current = await this.notes.read(file);
      if (!current.meta)
        throw new Error("This note has no OnceMarked identity.");
      const key = syncKey(current.meta.id, blog.id);
      const recovery = this.data.syncRecoveries?.[key];
      if (!recovery) throw new Error("No pre-sync recovery is available.");
      await this.notes.app.vault.process(file, () => recovery.source);
      const restored = await this.notes.read(file);
      if (restored.meta) await this.notes.remember(file, restored.meta);
      if (recovery.snapshot) this.data.syncSnapshots![key] = recovery.snapshot;
      else delete this.data.syncSnapshots?.[key];
      delete this.data.syncRecoveries![key];
      await this.save();
    });
  }
  async publish(
    file: TFile,
    blog: BlogConnection,
    review: Review,
    overwrite: boolean,
    progress: (message: string) => void,
  ): Promise<string> {
    return this.locked(file, async () => {
      if (review.blogId !== blog.id)
        throw new Error("Destination changed. Review again.");
      if (review.prepared.issues.length)
        throw new Error("Resolve the publishing checks first.");
      if (review.conflict && !overwrite)
        throw new Error("Review the remote changes before replacing the post.");
      let current = await this.notes.read(file);
      if (
        current.source !== review.source ||
        current.meta?.id !== review.noteId
      )
        throw new Error("The note changed after review. Review again.");
      const meta = current.meta;
      await this.notes.assertUnique(file, meta.id);
      if (meta.pending[blog.id])
        throw new Error("A request is already pending. Recover it first.");
      const { client, token } = this.connect(blog);
      const scope = await digest(blog.endpoint + "\n" + token);
      const binding = meta.posts[blog.id];
      if (
        binding &&
        (await sourceFingerprint(
          await client.source(binding.sourceUrl ?? binding.url),
        )) !== review.fingerprint
      )
        throw new Error("The remote post changed after review. Review again.");
      const uploaded = new Map<string, string>();
      for (const [path, image] of review.images) {
        progress(`Preparing ${image.name}…`);
        const bytes = await this.notes.app.vault.readBinary(image);
        const cacheKey = await digest(
          blog.id + "\n" + blog.endpoint + "\n" + (await digest(bytes)),
        );
        let record = this.data.media[cacheKey];
        if (!record) {
          await client.checkImageOptions({
            maxEdge: this.data.settings.images.maxEdge,
            quality: Math.round(this.data.settings.images.quality * 100),
          });
          const prepared = await optimiseImage(
            bytes,
            this.data.settings.images,
          );
          record = {
            scope,
            key: crypto.randomUUID(),
            created: Date.now(),
            mime: prepared.mime,
            options: {
              maxEdge: this.data.settings.images.maxEdge,
              quality: Math.round(this.data.settings.images.quality * 100),
            },
            bytes: toBase64(prepared.bytes),
          };
          this.data.media[cacheKey] = record;
          await this.save();
        }
        if (!record.url) {
          checkRecovery(record, scope);
          if (!record.bytes)
            throw new Error(
              "Image retry data is missing. Check the OnceMarked image library.",
            );
          progress(`Uploading ${image.name}…`);
          record.url = await client.upload(
            fromBase64(record.bytes),
            record.mime,
            record.key,
            record.options,
          );
          delete record.bytes;
          await this.save();
        }
        uploaded.set(path, mediaPath(record.url));
      }
      const replacements = new Map<string, string>();
      for (const [path, placeholder] of review.placeholders)
        replacements.set(placeholder, uploaded.get(path)!);
      const markdown = replaceImagePaths(
        review.prepared.markdown,
        replacements,
      );
      current = await this.notes.read(file);
      if (current.source !== review.source)
        throw new Error(
          "The note changed during uploads. Review again; completed uploads are cached.",
        );
      if (
        binding &&
        (await sourceFingerprint(
          await client.source(binding.sourceUrl ?? binding.url),
        )) !== review.fingerprint
      )
        throw new Error(
          "The remote post changed during uploads. Review again; completed uploads are cached.",
        );
      const properties = propertiesFor(
        review.input.title,
        review.input.slug,
        review.input.tags,
        review.input.state,
        markdown,
      );
      const pending = {
        key: crypto.randomUUID(),
        created: Date.now(),
        scope,
        properties,
        revision: review.remote
          ? textProperty(review.remote, "oncemarked-revision") || undefined
          : undefined,
        url: binding?.sourceUrl ?? binding?.url,
        dependencies: review.prepared.dependencies,
      };
      await this.notes.mutate(file, meta.id, (note) => {
        if (note.pending[blog.id])
          throw new Error("Another request is pending.");
        note.pending[blog.id] = pending;
      });
      progress(
        review.input.state === "published" ? "Publishing…" : "Saving draft…",
      );
      return this.finish(file, blog, client, scope);
    });
  }
  async recover(file: TFile, blog: BlogConnection): Promise<string> {
    return this.locked(file, async () => {
      const { client, token } = this.connect(blog);
      return this.finish(
        file,
        blog,
        client,
        await digest(blog.endpoint + "\n" + token),
      );
    });
  }
  private async finish(
    file: TFile,
    blog: BlogConnection,
    client: MicropubClient,
    scope: string,
  ): Promise<string> {
    const { meta } = await this.notes.read(file);
    const pending = meta?.pending[blog.id];
    if (!meta || !pending)
      throw new Error("No request is pending for this blog.");
    await this.notes.assertUnique(file, meta.id);
    if (pending.scope !== scope) checkRecovery(pending, scope);
    let url = pending.result;
    if (!url) {
      checkRecovery(pending, scope);
      try {
        url = pending.url
          ? await client.update(
              pending.url,
              pending.properties,
              pending.key,
              pending.revision,
            )
          : await client.create(pending.properties, pending.key);
      } catch (error) {
        // A 412 from the content update guarantees this request made no post changes.
        if (error instanceof MicropubError && error.status === 412) {
          await this.notes.mutate(file, meta.id, (note) => {
            if (note.pending[blog.id]?.key === pending.key)
              delete note.pending[blog.id];
          });
          throw new Error(
            "The remote post changed. Review it again before saving.",
          );
        }
        throw error;
      }
      await this.notes.mutate(file, meta.id, (note) => {
        if (note.pending[blog.id]?.key !== pending.key)
          throw new Error("Recovery data changed.");
        note.pending[blog.id]!.result = url;
      });
    }
    const source = await client.source(url);
    const state = textProperty(source, "post-status");
    if (state !== "draft" && state !== "published")
      throw new Error("The saved post returned an unknown publication state.");
    const binding: Binding = {
      url: textProperty(source, "oncemarked-url") || url,
      sourceUrl: textProperty(source, "oncemarked-sourceUrl") || undefined,
      state,
      baseline:
        textProperty(source, "content") ===
          textProperty(pending.properties, "content") &&
        textProperty(source, "name") ===
          textProperty(pending.properties, "name") &&
        textProperty(source, "post-status") ===
          textProperty(pending.properties, "post-status")
          ? await sourceFingerprint(source)
          : "",
      dependencies: pending.dependencies,
      tags: (source.category ?? []).filter(
        (value): value is string => typeof value === "string",
      ),
      title: textProperty(source, "name"),
      slug: textProperty(source, "mp-slug"),
    };
    await this.notes.mutate(file, meta.id, (note) => {
      if (note.pending[blog.id]?.key !== pending.key)
        throw new Error("Recovery data changed.");
      note.posts[blog.id] = binding;
      note.lastBlog = blog.id;
      delete note.pending[blog.id];
    });
    const key = syncKey(meta.id, blog.id);
    this.data.syncSnapshots ??= {};
    this.data.syncRecoveries ??= {};
    if (binding.baseline) {
      const saved = await this.notes.read(file);
      this.data.syncSnapshots[key] = {
        localFingerprint: await digest(noteBody(saved.source)),
        remote: remoteBody(source, binding),
        fingerprint: binding.baseline,
      };
    } else delete this.data.syncSnapshots[key];
    delete this.data.syncRecoveries[key];
    await this.save();
    return binding.url;
  }
  async relink(file: TFile, blog: BlogConnection, url: string): Promise<void> {
    return this.locked(file, async () => {
      const address = new URL(url);
      if (address.protocol !== "https:" || address.username || address.password)
        throw new Error("Use an HTTPS post URL.");
      const { client } = this.connect(blog);
      const source = await client.source(address.href);
      const state = textProperty(source, "post-status");
      if (state !== "draft" && state !== "published")
        throw new Error("Unknown post state.");
      const meta = await this.notes.ensure(file);
      await this.notes.mutate(file, meta.id, (note) => {
        note.posts[blog.id] = {
          url: textProperty(source, "oncemarked-url") || address.href,
          sourceUrl: textProperty(source, "oncemarked-sourceUrl") || undefined,
          state,
          baseline: "",
          dependencies: [],
          tags: (source.category ?? []).filter(
            (value): value is string => typeof value === "string",
          ),
          title: textProperty(source, "name"),
          slug: textProperty(source, "mp-slug"),
        };
        note.lastBlog = blog.id;
        delete note.pending[blog.id];
      });
      const key = syncKey(meta.id, blog.id);
      delete this.data.syncSnapshots?.[key];
      delete this.data.syncRecoveries?.[key];
      await this.save();
      // Empty baseline intentionally requires remote content review before first replacement.
    });
  }
  async affected(id: string, _blogId: string): Promise<TFile[]> {
    const entries = await this.notes.all();
    const target = entries.find((entry) => entry.meta.id === id);
    const results: TFile[] = [];
    for (const entry of entries) {
      const bindings = Object.values(entry.meta.posts);
      if (entry.meta.id === id || !bindings.length) continue;
      if (
        bindings.some(
          (binding) =>
            binding.dependencies.includes(id) ||
            (target &&
              binding.dependencies.includes(`path:${target.file.path}`)),
        )
      ) {
        results.push(entry.file);
        continue;
      }
      // Re-resolve the current vault links as well, so Obsidian-renamed unpublished targets are found.
      const { source } = await this.notes.read(entry.file);
      const scan = await prepareMarkdown(source, {
        plainUnpublished: true,
        image: async (value) => value,
        resolve: async (path) => {
          const resolved = this.notes.resolve(path, entry.file);
          return resolved && target && resolved.path === target.file.path
            ? { id, state: "draft", url: "", markdown: "" }
            : undefined;
        },
      });
      if (scan.dependencies.includes(id)) results.push(entry.file);
    }
    return results;
  }
}
