/** Identity is metadata, never the current path or a content hash. */
export interface NoteIdentity {
  id: string;
  path: string;
}

export class IdentityIndex {
  private readonly paths = new Map<string, string>();
  private readonly previousPaths = new Map<string, Set<string>>();

  rebuild(notes: readonly NoteIdentity[]): void {
    this.paths.clear();
    for (const note of notes) this.observe(note);
  }

  observe(note: NoteIdentity): void {
    if (!note.id || !note.path)
      throw new Error("Note identity and path are required.");
    this.paths.set(note.path, note.id);
    const history = this.previousPaths.get(note.id) ?? new Set<string>();
    history.add(note.path);
    this.previousPaths.set(note.id, history);
  }

  remove(path: string): void {
    this.paths.delete(path);
  }

  move(from: string, to: string): void {
    const id = this.paths.get(from);
    if (!id) throw new Error("The source note is not tracked.");
    if (this.paths.has(to))
      throw new Error("The destination is already tracked.");
    this.remove(from);
    this.observe({ id, path: to });
  }

  locate(id: string): string | null {
    const matches = [...this.paths].filter(([, value]) => value === id);
    if (matches.length > 1)
      throw new Error(
        "Duplicate OnceMarked identity. Resolve the copied note before publishing.",
      );
    return matches[0]?.[0] ?? null;
  }

  history(id: string): readonly string[] {
    return [...(this.previousPaths.get(id) ?? [])];
  }
}
