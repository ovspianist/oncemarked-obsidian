import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import type { Root, RootContent, Definition } from "mdast";
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter);
type Node = Root | RootContent;
export const parseMarkdown = (source: string): Root => parser.parse(source);
const start = (node: Node) => node.position?.start.offset ?? 0;
const end = (node: Node) => node.position?.end.offset ?? 0;
const plain = (node: Node): string =>
  "value" in node
    ? node.value
    : "children" in node
      ? node.children.map((n) => plain(n as Node)).join("")
      : "";
function walk(node: Node, visit: (node: Node) => boolean | void): void {
  if (visit(node) !== false && "children" in node)
    for (const child of node.children) walk(child as Node, visit);
}
export function headingId(title: string, seen: Map<string, number>): string {
  const base =
    "section-" +
    (title
      .toLowerCase()
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "heading");
  const count = (seen.get(base) ?? 0) + 1;
  seen.set(base, count);
  return count === 1 ? base : `${base}-${count}`;
}
export function headingFragment(
  markdown: string,
  heading: string,
): string | undefined {
  const seen = new Map<string, number>();
  let result: string | undefined;
  walk(parseMarkdown(markdown), (node) => {
    if (node.type === "heading") {
      const title = plain(node);
      const id = headingId(title, seen);
      if (
        result === undefined &&
        (title.normalize("NFKC").toLowerCase() ===
          heading.normalize("NFKC").toLowerCase() ||
          id === heading)
      )
        result = id;
    }
  });
  return result;
}
export function protectedPosition(source: string, offset: number): boolean {
  let protectedValue = false;
  walk(parseMarkdown(source), (node) => {
    if (
      [
        "code",
        "inlineCode",
        "html",
        "yaml",
        "link",
        "image",
        "linkReference",
        "imageReference",
      ].includes(node.type) &&
      start(node) <= offset &&
      end(node) >= offset
    ) {
      protectedValue = true;
      return false;
    }
  });
  return protectedValue;
}
export function variableTrigger(
  source: string,
  offset: number,
): { start: number; query: string } | null {
  const before = source.slice(0, offset);
  const match = /\{\{\s*([a-z_]*)$/.exec(before);
  if (!match) return null;
  const from = offset - match[0].length;
  if (
    (/\\*$/.exec(source.slice(0, from))?.[0].length ?? 0) % 2 ||
    protectedPosition(source, from)
  )
    return null;
  // An unfinished inline-code span is not yet represented as inlineCode by the parser.
  const paragraph = before.slice(
    before.lastIndexOf("\n\n") < 0 ? 0 : before.lastIndexOf("\n\n") + 2,
  );
  let delimiter = 0;
  for (const ticks of paragraph.matchAll(/`+/g)) {
    if ((/\\*$/.exec(paragraph.slice(0, ticks.index))?.[0].length ?? 0) % 2)
      continue;
    if (!delimiter) delimiter = ticks[0].length;
    else if (delimiter === ticks[0].length) delimiter = 0;
  }
  if (delimiter) return null;
  let insideComment = false;
  for (const comment of before.matchAll(/%%/g)) {
    if (
      !protectedPosition(source, comment.index!) &&
      !((/\\*$/.exec(before.slice(0, comment.index))?.[0].length ?? 0) % 2)
    )
      insideComment = !insideComment;
  }
  if (insideComment) return null;
  return { start: from, query: match[1] ?? "" };
}
export interface LinkTarget {
  id: string;
  url: string;
  markdown: string;
  state: string;
}
export interface PreparedMarkdown {
  markdown: string;
  issues: string[];
  dependencies: string[];
}
export interface PrepareOptions {
  resolve: (target: string) => Promise<LinkTarget | undefined>;
  image: (target: string) => Promise<string>;
  plainUnpublished: boolean;
}
function label(value: string): string {
  return value.replace(/[\\[\]`*_]/g, "\\$&").replace(/\r?\n/g, " ");
}
function safeUrl(value: string): string {
  return value.replace(
    /[\s<>\\()]/g,
    (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase(),
  );
}
/** Patches AST ranges; fenced code, formatting and untouched source are preserved. */
export async function prepareMarkdown(
  original: string,
  options: PrepareOptions,
): Promise<PreparedMarkdown> {
  const codeRanges: [number, number][] = [];
  walk(parseMarkdown(original), (node) => {
    if (["code", "inlineCode"].includes(node.type)) {
      codeRanges.push([start(node), end(node)]);
      return false;
    }
  });
  let source = "";
  let comment = false;
  for (let i = 0; i < original.length;) {
    const range = !comment && codeRanges.find(([a, b]) => i >= a && i < b);
    if (range) {
      source += original.slice(i, range[1]);
      i = range[1];
      continue;
    }
    if (
      original.slice(i, i + 2) === "%%" &&
      (/\\*$/.exec(original.slice(0, i))?.[0].length ?? 0) % 2 === 0
    ) {
      comment = !comment;
      i += 2;
      continue;
    }
    if (!comment || original[i] === "\n") source += original[i];
    i++;
  }
  const tree = parseMarkdown(source);
  const issues: string[] = [];
  const dependencies = new Set<string>();
  const patches: { from: number; to: number; text: string }[] = [];
  const definitions = new Map<string, Definition>();
  walk(tree, (node) => {
    if (node.type === "definition")
      definitions.set(node.identifier.toLowerCase(), node);
  });
  const tasks: Promise<void>[] = [];
  const patch = (node: Node, text: string): void => {
    patches.push({ from: start(node), to: end(node), text });
  };
  async function resolveLink(target: string, display: string): Promise<string> {
    if (/^(https?:|mailto:|tel:)/i.test(target)) {
      if (/^https?:/i.test(target)) {
        const url = new URL(target);
        if (
          url.username ||
          url.password ||
          (url.hostname === "oncemarked.com" &&
            url.pathname.startsWith("/blogs/entries/"))
        ) {
          issues.push(`Private or credential-bearing link: ${display}`);
          return label(display);
        }
      }
      return `[${label(display)}](${safeUrl(target)})`;
    }
    if (/^[a-z][\w+.-]*:|^\/\//i.test(target)) {
      issues.push(`Unsupported link: ${display}`);
      return label(display);
    }
    const [path = "", fragment] = target.split("#", 2);
    if (fragment?.startsWith("^")) {
      issues.push(`Block links are not supported: ${display}`);
      return label(display);
    }
    const linked = path
      ? await options.resolve(decodePath(path))
      : { id: "", url: "", state: "published", markdown: source };
    if (linked?.id) dependencies.add(linked.id);
    if (!linked || linked.state !== "published") {
      if (!options.plainUnpublished)
        issues.push(`Linked note is missing or unpublished: ${display}`);
      return label(display);
    }
    let suffix = "";
    if (fragment) {
      const id = headingFragment(linked.markdown, decodePath(fragment));
      if (!id) {
        issues.push(`Heading not found in published content: ${display}`);
        return label(display);
      }
      suffix = "#" + id;
    }
    return `[${label(display)}](${safeUrl(linked.url + suffix)})`;
  }
  async function resolveImage(target: string, alt: string): Promise<string> {
    try {
      const url = await options.image(target);
      return `![${alt.replace(/[\[\]\\\r\n]/g, " ")}](${url})`;
    } catch (error) {
      issues.push(
        error instanceof Error ? error.message : "Image could not be prepared.",
      );
      return label(alt);
    }
  }
  walk(tree, (node) => {
    if (["code", "inlineCode"].includes(node.type)) return false;
    if (node.type === "yaml" || node.type === "definition") {
      patch(node, "");
      return false;
    }
    if (node.type === "html") {
      issues.push("Raw HTML is not supported. Remove it before publishing.");
      return false;
    }
    if (
      node.type === "link" ||
      node.type === "image" ||
      node.type === "linkReference" ||
      node.type === "imageReference"
    ) {
      const ref =
        "identifier" in node
          ? definitions.get(node.identifier.toLowerCase())
          : undefined;
      const target = "url" in node ? node.url : ref?.url;
      if (!target) {
        issues.push("Unresolved Markdown reference.");
        return false;
      }
      const isImage = node.type === "image" || node.type === "imageReference";
      tasks.push(
        (async () =>
          patch(
            node,
            isImage
              ? await resolveImage(
                  target,
                  "alt" in node ? (node.alt ?? "") : "",
                )
              : /^(https?:|mailto:|tel:)/i.test(target)
                ? await resolveLink(target, plain(node)).then((converted) =>
                    converted.startsWith("[") && node.type === "link"
                      ? source.slice(start(node), end(node))
                      : converted,
                  )
                : await resolveLink(target, plain(node)),
          ))(),
      );
      return false;
    }
  });
  const protectedRanges: [number, number][] = [];
  walk(tree, (node) => {
    if (
      [
        "code",
        "inlineCode",
        "yaml",
        "html",
        "definition",
        "link",
        "image",
        "linkReference",
        "imageReference",
      ].includes(node.type)
    ) {
      protectedRanges.push([start(node), end(node)]);
      return false;
    }
  });
  for (const match of source.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
    const from = match.index!;
    const to = from + match[0].length;
    if (
      protectedRanges.some(([a, b]) => from < b && to > a) ||
      (/\\*$/.exec(source.slice(0, from))?.[0].length ?? 0) % 2
    )
      continue;
    const [target = "", alias] = match[2]!.split("|");
    tasks.push(
      (async () => {
        const text = match[1]
          ? await resolveImage(
              target,
              alias && !/^\d+(?:x\d+)?$/.test(alias)
                ? alias
                : (target.split("/").pop() ?? ""),
            )
          : await resolveLink(target, alias ?? target);
        patches.push({ from, to, text });
      })(),
    );
  }
  await Promise.all(tasks);
  let markdown = source;
  for (const item of patches.sort((a, b) => b.from - a.from))
    markdown =
      markdown.slice(0, item.from) + item.text + markdown.slice(item.to);
  issues.push(...outgoingIssues(markdown));
  return {
    markdown: markdown.trim(),
    issues: [...new Set(issues)],
    dependencies: [...dependencies],
  };
}

export function replaceImagePaths(
  source: string,
  replacements: ReadonlyMap<string, string>,
): string {
  const patches: { from: number; to: number; text: string }[] = [];
  walk(parseMarkdown(source), (node) => {
    if (node.type === "image" && replacements.has(node.url))
      patches.push({
        from: start(node),
        to: end(node),
        text: `![${(node.alt ?? "").replace(/[\[\]\\\r\n]/g, " ")}](${replacements.get(node.url)!})`,
      });
  });
  let result = source;
  for (const item of patches.sort((a, b) => b.from - a.from))
    result = result.slice(0, item.from) + item.text + result.slice(item.to);
  return result;
}

/** Mirror the currently documented server's content limits before any uploads. */
export function outgoingIssues(markdown: string): string[] {
  const issues: string[] = [];
  if (/<\s*\/?\s*[a-z][^>]*>/i.test(markdown))
    issues.push(
      "OnceMarked does not accept raw HTML, including HTML examples in code. Escape or remove it before publishing.",
    );
  const withoutImages = markdown.replace(
    /!\[[^\]\r\n]*\]\(\/__media\/[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}\.webp\)/gi,
    "",
  );
  if (/!\[[^\]]*\]\s*\(/.test(withoutImages))
    issues.push(
      "OnceMarked accepts only uploaded image references, including in code examples.",
    );
  if (/(?:^|\n)\s*\$\$|\\[([]/.test(markdown))
    issues.push(
      "OnceMarked does not support mathematical notation extensions.",
    );
  return issues;
}

export function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
