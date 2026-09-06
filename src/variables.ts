// Catalogue verified against OnceMarked on 2026-09-06. No runtime platform dependency.
export interface Variable {
  name: string;
  description: string;
  source: string;
  block: boolean;
}
export const VARIABLES: readonly Variable[] = [
  {
    name: "posts",
    description: "Recent posts",
    source: "{{ posts limit: 5 }}",
    block: true,
  },
  {
    name: "posts_by_year",
    description: "Posts grouped by year",
    source: "{{ posts_by_year limit: 50 }}",
    block: true,
  },
  {
    name: "pages",
    description: "Published pages",
    source: "{{ pages }}",
    block: true,
  },
  {
    name: "tags",
    description: "Links to post tags",
    source: "{{ tags }}",
    block: true,
  },
  {
    name: "table_of_contents",
    description: "Linked article headings",
    source: "{{ table_of_contents }}",
    block: true,
  },
  {
    name: "previous_post",
    description: "Previous (older) post",
    source: "{{ previous_post }}",
    block: false,
  },
  {
    name: "next_post",
    description: "Next (newer) post",
    source: "{{ next_post }}",
    block: false,
  },
  {
    name: "blog_title",
    description: "Blog title",
    source: "{{ blog_title }}",
    block: false,
  },
  {
    name: "blog_description",
    description: "Blog description",
    source: "{{ blog_description }}",
    block: false,
  },
  {
    name: "blog_url",
    description: "Blog address",
    source: "{{ blog_url }}",
    block: false,
  },
  {
    name: "blog_language",
    description: "Blog language",
    source: "{{ blog_language }}",
    block: false,
  },
  {
    name: "blog_created_date",
    description: "Blog creation date",
    source: "{{ blog_created_date }}",
    block: false,
  },
  {
    name: "blog_updated_date",
    description: "Blog update date",
    source: "{{ blog_updated_date }}",
    block: false,
  },
  {
    name: "author_name",
    description: "Public author name",
    source: "{{ author_name }}",
    block: false,
  },
  {
    name: "author_handle",
    description: "Public author handle",
    source: "{{ author_handle }}",
    block: false,
  },
  {
    name: "post_title",
    description: "Current post or page title",
    source: "{{ post_title }}",
    block: false,
  },
  {
    name: "post_description",
    description: "Current post or page summary",
    source: "{{ post_description }}",
    block: false,
  },
  {
    name: "post_url",
    description: "Current post or page address",
    source: "{{ post_url }}",
    block: false,
  },
  {
    name: "reading_time",
    description: "Estimated reading time",
    source: "{{ reading_time }}",
    block: false,
  },
  {
    name: "post_language",
    description: "Current post or page language",
    source: "{{ post_language }}",
    block: false,
  },
  {
    name: "post_published_date",
    description: "Publication date",
    source: "{{ post_published_date }}",
    block: false,
  },
  {
    name: "post_updated_date",
    description: "Post or page update date",
    source: "{{ post_updated_date }}",
    block: false,
  },
  {
    name: "post_count",
    description: "Published post count",
    source: "{{ post_count }}",
    block: false,
  },
  {
    name: "page_count",
    description: "Published page count",
    source: "{{ page_count }}",
    block: false,
  },
  {
    name: "year",
    description: "Current year (UTC)",
    source: "{{ year }}",
    block: false,
  },
  {
    name: "rss_url",
    description: "RSS feed address",
    source: "{{ rss_url }}",
    block: false,
  },
  {
    name: "atom_url",
    description: "Atom feed address",
    source: "{{ atom_url }}",
    block: false,
  },
];
export function searchVariables(query: string): readonly Variable[] {
  const term = query.trim().toLowerCase();
  return VARIABLES.filter((item) =>
    `${item.name} ${item.description}`.toLowerCase().includes(term),
  );
}
export function variableInsertion(
  variable: Variable,
  before: string,
  after: string,
): string {
  if (!variable.block) return variable.source;
  const prefix =
    !before || before.endsWith("\n\n")
      ? ""
      : before.endsWith("\n")
        ? "\n"
        : "\n\n";
  const suffix =
    !after || after.startsWith("\n\n")
      ? ""
      : after.startsWith("\n")
        ? "\n"
        : "\n\n";
  return prefix + variable.source + suffix;
}

export function parameterSource(
  name: string,
  options: {
    limit: string;
    skip: string;
    tag: string;
    year: string;
    sort: string;
  },
): string {
  const parts = [name];
  for (const [key, max, min] of [
    ["limit", 50, 1],
    ["skip", 5000, 0],
    ["year", 9999, 1000],
  ] as const) {
    const value = options[key].trim();
    if (value) {
      if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max)
        throw new Error(`${key} must be ${min}–${max}.`);
      parts.push(`${key}: ${Number(value)}`);
    }
  }
  if (options.tag) {
    if (/["\\\n\r]/.test(options.tag))
      throw new Error("Tag cannot contain quotes, backslashes or line breaks.");
    parts.push(`tag: "${options.tag}"`);
  }
  if (options.sort) {
    if (!["newest", "oldest", "alpha"].includes(options.sort))
      throw new Error("Choose a valid sort order.");
    parts.push(`sort: ${options.sort}`);
  }
  return "{{ " + parts.join(" ") + " }}";
}
