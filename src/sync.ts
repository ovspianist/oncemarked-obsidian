export const CONFLICT_START = "<<<<<<< Obsidian";
export const CONFLICT_MIDDLE = "=======";
export const CONFLICT_END = ">>>>>>> OnceMarked";

interface Change {
  start: number;
  end: number;
  replacement: string[];
}

export interface MergeResult {
  markdown: string;
  conflicts: number;
}

function lines(value: string): string[] {
  return value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function changes(base: string[], target: string[]): Change[] {
  if (base.join("") === target.join("")) return [];
  // A pathological one-line minified note should not make sync allocate an
  // unbounded matrix. The safe fallback is one whole-document conflict.
  if ((base.length + 1) * (target.length + 1) > 4_000_000)
    return [{ start: 0, end: base.length, replacement: target }];
  const width = target.length + 1;
  const table = new Uint32Array((base.length + 1) * width);
  for (let a = base.length - 1; a >= 0; a--)
    for (let b = target.length - 1; b >= 0; b--)
      table[a * width + b] =
        base[a] === target[b]
          ? 1 + table[(a + 1) * width + b + 1]!
          : Math.max(table[(a + 1) * width + b]!, table[a * width + b + 1]!);
  const result: Change[] = [];
  let a = 0;
  let b = 0;
  let current: Change | undefined;
  const open = () => (current ??= { start: a, end: a, replacement: [] });
  const close = () => {
    if (current) result.push(current);
    current = undefined;
  };
  while (a < base.length || b < target.length) {
    if (a < base.length && b < target.length && base[a] === target[b]) {
      close();
      a++;
      b++;
    } else if (
      b < target.length &&
      (a === base.length ||
        table[a * width + b + 1]! >= table[(a + 1) * width + b]!)
    ) {
      open().replacement.push(target[b]!);
      b++;
    } else {
      open().end = ++a;
    }
  }
  close();
  return result;
}

function same(a: Change, b: Change): boolean {
  return (
    a.start === b.start &&
    a.end === b.end &&
    a.replacement.join("") === b.replacement.join("")
  );
}

function overlaps(a: Change, b: Change): boolean {
  const aInsert = a.start === a.end;
  const bInsert = b.start === b.end;
  if (aInsert && bInsert) return a.start === b.start;
  if (aInsert) return a.start >= b.start && a.start < b.end;
  if (bInsert) return b.start >= a.start && b.start < a.end;
  return a.start < b.end && b.start < a.end;
}

function overlapsSpan(change: Change, start: number, end: number): boolean {
  if (start === end)
    return change.start === change.end && change.start === start;
  if (change.start === change.end)
    return change.start >= start && change.start < end;
  return change.start < end && change.end > start;
}

function apply(base: string[], start: number, end: number, edits: Change[]) {
  let cursor = start;
  let result = "";
  for (const edit of edits) {
    result += base.slice(cursor, edit.start).join("");
    result += edit.replacement.join("");
    cursor = edit.end;
  }
  return result + base.slice(cursor, end).join("");
}

function candidate(value: string): string {
  return value && !value.endsWith("\n") ? value + "\n" : value;
}

function conflict(local: string, remote: string): string {
  return `${CONFLICT_START}\n${candidate(local)}${CONFLICT_MIDDLE}\n${candidate(remote)}${CONFLICT_END}\n`;
}

/** Line-oriented diff3 merge. Independent edits merge; overlapping edits get Git-style markers. */
export function mergeMarkdown(
  baseMarkdown: string,
  localMarkdown: string,
  remoteMarkdown: string,
): MergeResult {
  if (localMarkdown === remoteMarkdown)
    return { markdown: localMarkdown, conflicts: 0 };
  if (localMarkdown === baseMarkdown)
    return { markdown: remoteMarkdown, conflicts: 0 };
  if (remoteMarkdown === baseMarkdown)
    return { markdown: localMarkdown, conflicts: 0 };
  const base = lines(baseMarkdown);
  const local = changes(base, lines(localMarkdown));
  const remote = changes(base, lines(remoteMarkdown));
  let li = 0;
  let ri = 0;
  let cursor = 0;
  let markdown = "";
  let conflicts = 0;
  while (li < local.length || ri < remote.length) {
    const left = local[li];
    const right = remote[ri];
    if (
      !right ||
      (left && left.start < right.start && !overlaps(left, right))
    ) {
      markdown += base.slice(cursor, left!.start).join("");
      markdown += left!.replacement.join("");
      cursor = left!.end;
      li++;
      continue;
    }
    if (!left || (right.start < left.start && !overlaps(left, right))) {
      markdown += base.slice(cursor, right.start).join("");
      markdown += right.replacement.join("");
      cursor = right.end;
      ri++;
      continue;
    }
    if (same(left!, right)) {
      markdown += base.slice(cursor, left!.start).join("");
      markdown += left!.replacement.join("");
      cursor = left!.end;
      li++;
      ri++;
      continue;
    }
    let start = Math.min(left!.start, right.start);
    let end = Math.max(left!.end, right.end);
    const localGroup: Change[] = [];
    const remoteGroup: Change[] = [];
    let expanded = true;
    while (expanded) {
      expanded = false;
      while (local[li] && overlapsSpan(local[li]!, start, end)) {
        const edit = local[li++]!;
        localGroup.push(edit);
        start = Math.min(start, edit.start);
        if (edit.end > end) {
          end = edit.end;
          expanded = true;
        }
      }
      while (remote[ri] && overlapsSpan(remote[ri]!, start, end)) {
        const edit = remote[ri++]!;
        remoteGroup.push(edit);
        start = Math.min(start, edit.start);
        if (edit.end > end) {
          end = edit.end;
          expanded = true;
        }
      }
    }
    // Both initial edits are guaranteed to overlap. Zero-length insertion
    // groups need explicit consumption because their span is also zero.
    if (!localGroup.length) localGroup.push(local[li++]!);
    if (!remoteGroup.length) remoteGroup.push(remote[ri++]!);
    end = Math.max(
      end,
      ...localGroup.map((item) => item.end),
      ...remoteGroup.map((item) => item.end),
    );
    const localCandidate = apply(base, start, end, localGroup);
    const remoteCandidate = apply(base, start, end, remoteGroup);
    markdown += base.slice(cursor, start).join("");
    if (localCandidate === remoteCandidate) markdown += localCandidate;
    else {
      markdown += conflict(localCandidate, remoteCandidate);
      conflicts++;
    }
    cursor = end;
  }
  markdown += base.slice(cursor).join("");
  return { markdown, conflicts };
}

export function twoWayConflict(
  localMarkdown: string,
  remoteMarkdown: string,
): MergeResult {
  return {
    markdown: conflict(localMarkdown, remoteMarkdown),
    conflicts: localMarkdown === remoteMarkdown ? 0 : 1,
  };
}

export function hasConflictMarkers(markdown: string): boolean {
  return /^(?:<<<<<<< Obsidian|>>>>>>> OnceMarked)$/m.test(markdown);
}
