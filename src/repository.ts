import { getFrontMatterInfo, parseYaml, TFile, type App } from "obsidian";
import { newMeta, readMeta, type NoteMeta, type SavedData } from "./model";
export function metadata(source: string): {
  properties: Record<string, unknown>;
  meta?: NoteMeta;
} {
  const info = getFrontMatterInfo(source);
  const value: unknown = info.exists ? parseYaml(info.frontmatter) : {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The note has invalid YAML properties.");
  const properties = value as Record<string, unknown>;
  return { properties, meta: readMeta(properties.oncemarked) };
}
export class NoteRepository {
  constructor(
    readonly app: App,
    private readonly data: SavedData,
    private readonly save: () => Promise<void>,
  ) {}
  async read(file: TFile): Promise<{
    source: string;
    properties: Record<string, unknown>;
    meta?: NoteMeta;
  }> {
    const source = await this.app.vault.read(file);
    return { source, ...metadata(source) };
  }
  async all(): Promise<{ file: TFile; meta: NoteMeta }[]> {
    const entries: { file: TFile; meta: NoteMeta }[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      try {
        const { meta } = await this.read(file);
        if (meta) entries.push({ file, meta });
      } catch {
        /* An unrelated malformed note must not stop the vault index. Target notes are checked strictly. */
      }
    }
    return entries;
  }
  async assertUnique(file: TFile, id: string): Promise<void> {
    if (
      (await this.all()).some(
        (item) => item.meta.id === id && item.file.path !== file.path,
      )
    )
      throw new Error(
        "This note shares a OnceMarked ID with another file. Use “Give copied note a new identity” before publishing.",
      );
  }
  async ensure(file: TFile): Promise<NoteMeta> {
    const current = await this.read(file);
    if (current.meta) {
      await this.assertUnique(file, current.meta.id);
      return current.meta;
    }
    const meta = newMeta();
    await this.app.fileManager.processFrontMatter(
      file,
      (props: Record<string, unknown>) => {
        if (props.oncemarked !== undefined)
          throw new Error("Note identity changed. Open publishing again.");
        props.oncemarked = meta;
      },
    );
    await this.remember(file, meta);
    return meta;
  }
  async mutate(
    file: TFile,
    id: string,
    update: (meta: NoteMeta) => void,
  ): Promise<NoteMeta> {
    await this.assertUnique(file, id);
    let updated: NoteMeta | undefined;
    await this.app.fileManager.processFrontMatter(
      file,
      (props: Record<string, unknown>) => {
        const meta = readMeta(props.oncemarked);
        if (!meta || meta.id !== id)
          throw new Error("Note identity changed. Reopen publishing.");
        update(meta);
        props.oncemarked = meta;
        updated = meta;
      },
    );
    if (!updated) throw new Error("Could not save OnceMarked note properties.");
    await this.remember(file, updated);
    return updated;
  }
  async remember(file: TFile, meta: NoteMeta): Promise<void> {
    this.data.history[meta.id] = {
      path: file.path,
      meta: structuredClone(meta),
    };
    await this.save();
  }
  async rebuild(): Promise<void> {
    const entries = await this.all();
    const counts = new Map<string, number>();
    for (const { meta } of entries)
      counts.set(meta.id, (counts.get(meta.id) ?? 0) + 1);
    for (const { file, meta } of entries)
      if (counts.get(meta.id) === 1)
        this.data.history[meta.id] = { path: file.path, meta };
    await this.save();
  }
  resolve(path: string, from: TFile): TFile | undefined {
    const file = this.app.metadataCache.getFirstLinkpathDest(path, from.path);
    return file instanceof TFile ? file : undefined;
  }
  async resetCopy(file: TFile): Promise<void> {
    const current = await this.read(file);
    if (current.meta && Object.keys(current.meta.pending).length)
      throw new Error("Reconcile pending requests before changing identity.");
    await this.app.fileManager.processFrontMatter(
      file,
      (props: Record<string, unknown>) => {
        props.oncemarked = newMeta();
      },
    );
    const after = await this.read(file);
    if (after.meta) await this.remember(file, after.meta);
  }
}
