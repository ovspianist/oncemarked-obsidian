import { expect, it } from "vitest";
import {
  VARIABLES,
  searchVariables,
  variableInsertion,
} from "../src/variables";
it("finds catalogue entries by description as well as name", () => {
  expect(searchVariables("older")[0]?.name).toBe("previous_post");
  expect(new Set(VARIABLES.map((v) => v.name)).size).toBe(27);
});
it("inserts literal scalar source without replacing values", () => {
  const variable = VARIABLES.find((v) => v.name === "author_name")!;
  expect(variableInsertion(variable, "By ", ".")).toBe("{{ author_name }}");
});
it("separates block variables from existing text without redundant blank lines", () => {
  const variable = VARIABLES.find((v) => v.name === "posts")!;
  expect(variableInsertion(variable, "Before", "After")).toBe(
    "\n\n{{ posts limit: 5 }}\n\n",
  );
  expect(variableInsertion(variable, "Before\n\n", "\nAfter")).toBe(
    "{{ posts limit: 5 }}\n",
  );
  expect(variableInsertion(variable, "", "")).toBe("{{ posts limit: 5 }}");
});

it("validates variable parameters instead of inserting malformed expressions", async () => {
  const { parameterSource } = await import("../src/variables");
  expect(
    parameterSource("posts", {
      limit: "5",
      skip: "0",
      tag: "Notes",
      year: "2026",
      sort: "newest",
    }),
  ).toBe('{{ posts limit: 5 skip: 0 year: 2026 tag: "Notes" sort: newest }}');
  expect(() =>
    parameterSource("posts", {
      limit: "51",
      skip: "",
      tag: "",
      year: "",
      sort: "",
    }),
  ).toThrow("1–50");
  expect(() =>
    parameterSource("posts", {
      limit: "5",
      skip: "",
      tag: '" bad',
      year: "",
      sort: "",
    }),
  ).toThrow("quotes");
});

it("offers reading time offline and inserts it literally", () => {
  const variable = searchVariables("reading_time")[0]!;
  expect(variable.name).toBe("reading_time");
  expect(variableInsertion(variable, "", "")).toBe("{{ reading_time }}");
});
