import { parse, stringify } from "yaml";
export const parseYaml = parse;
export const stringifyYaml = stringify;
export function getFrontMatterInfo(source: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  return {
    exists: !!match,
    frontmatter: match?.[1] ?? "",
    contentStart: match?.[0].length ?? 0,
  };
}
export class TFile {
  stat = { size: 10, mtime: 1, ctime: 1 };
  constructor(public path: string) {}
  get extension() {
    return this.path.split(".").pop() ?? "";
  }
  get name() {
    return this.path.split("/").pop() ?? "";
  }
  get basename() {
    return this.name.replace(/\.[^.]+$/, "");
  }
}
