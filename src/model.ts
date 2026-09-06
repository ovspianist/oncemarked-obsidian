import type { Properties } from "./micropub";
export interface BlogConnection {
  id: string;
  name: string;
  endpoint: string;
  tokenName: string;
  variables?: import("./variables").Variable[];
}
export interface ImageSettings {
  enabled: boolean;
  maxEdge: number;
  quality: number;
}
export interface Settings {
  blogs: BlogConnection[];
  removedBlogs?: BlogConnection[];
  defaultBlog: string;
  images: ImageSettings;
}
export interface Binding {
  url: string;
  sourceUrl?: string;
  state: "draft" | "published";
  baseline: string;
  dependencies: string[];
  tags?: string[];
  title?: string;
  slug?: string;
}
export interface PendingPost {
  key: string;
  created: number;
  scope: string;
  properties: Properties;
  revision?: string;
  url?: string;
  result?: string;
  dependencies: string[];
}
export interface NoteMeta {
  lastBlog?: string;
  version: 1;
  id: string;
  posts: Record<string, Binding>;
  pending: Record<string, PendingPost>;
}
export interface MediaRecord {
  scope: string;
  key: string;
  created: number;
  mime: string;
  options?: { maxEdge: number; quality: number };
  bytes?: string;
  url?: string;
}
export interface SavedData {
  settings: Settings;
  media: Record<string, MediaRecord>;
  history: Record<string, { path: string; meta: NoteMeta }>;
}
export const defaultSettings = (): Settings => ({
  blogs: [],
  defaultBlog: "",
  images: { enabled: true, maxEdge: 1600, quality: 0.8 },
});
export function newMeta(): NoteMeta {
  return { version: 1, id: crypto.randomUUID(), posts: {}, pending: {} };
}
export function readMeta(value: unknown): NoteMeta | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object")
    throw new Error(
      "OnceMarked note properties are invalid. Restore them or use the identity repair command.",
    );
  const data = value as NoteMeta;
  if (
    data.version !== 1 ||
    typeof data.id !== "string" ||
    !data.id ||
    !data.posts ||
    !data.pending ||
    typeof data.posts !== "object" ||
    typeof data.pending !== "object" ||
    Array.isArray(data.posts) ||
    Array.isArray(data.pending)
  )
    throw new Error("OnceMarked note properties are invalid.");
  for (const binding of Object.values(data.posts)) {
    if (
      !binding ||
      typeof binding.url !== "string" ||
      !["draft", "published"].includes(binding.state) ||
      typeof binding.baseline !== "string" ||
      !Array.isArray(binding.dependencies)
    )
      throw new Error("OnceMarked post association is invalid.");
  }
  for (const pending of Object.values(data.pending)) {
    if (
      !pending ||
      typeof pending.key !== "string" ||
      typeof pending.scope !== "string" ||
      typeof pending.created !== "number" ||
      !pending.properties ||
      typeof pending.properties !== "object" ||
      !Array.isArray(pending.dependencies)
    )
      throw new Error("OnceMarked recovery data is invalid.");
  }
  return structuredClone(data);
}
export async function digest(value: string | ArrayBuffer): Promise<string> {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ":" + stableJson(item))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
export const sourceFingerprint = (properties: Properties): Promise<string> =>
  digest(stableJson(properties));
export function checkRecovery(
  pending: { created: number; scope: string },
  scope: string,
  now = Date.now(),
): void {
  if (pending.scope !== scope)
    throw new Error(
      "The connection or token changed. Reconcile the saved request before sending through a different connection.",
    );
  if (
    now - pending.created >= 23 * 60 * 60 * 1000 ||
    pending.created > now + 60_000
  )
    throw new Error(
      "The safe retry window has ended. Check OnceMarked and relink the saved post or clear the request only after confirming it did not succeed.",
    );
}
export function propertiesFor(
  title: string,
  slug: string,
  tags: string[],
  state: string,
  markdown: string,
): Properties {
  if (!title.trim() || title.trim().length > 200)
    throw new Error("Use a title of 1–200 characters.");
  if (
    slug &&
    (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) || slug.length > 80)
  )
    throw new Error(
      "Use a slug of at most 80 lowercase letters, numbers and internal hyphens.",
    );
  if (tags.length > 5 || tags.some((tag) => !tag.trim() || tag.length > 32))
    throw new Error("Use up to five tags, each at most 32 characters.");
  if (!["draft", "published"].includes(state))
    throw new Error("Choose draft or published.");
  if (!markdown.trim() || markdown.length > 200_000)
    throw new Error("Write between 1 and 200,000 characters.");
  return {
    name: [title.trim()],
    content: [markdown],
    category: [...new Set(tags)],
    "post-status": [state],
    ...(slug ? { "mp-slug": [slug] } : {}),
  };
}
