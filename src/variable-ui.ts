import {
  EditorSuggest,
  FuzzySuggestModal,
  Modal,
  Setting,
  type App,
  type Editor,
  type EditorPosition,
  type EditorSuggestContext,
  type EditorSuggestTriggerInfo,
  type TFile,
} from "obsidian";
import {
  VARIABLES,
  parameterSource,
  variableInsertion,
  type Variable,
} from "./variables";
import { variableTrigger } from "./markdown";
export class VariableParameters extends Modal {
  constructor(
    app: App,
    private readonly variable: Variable,
    private readonly insert: (value: Variable) => void,
  ) {
    super(app);
  }
  onOpen(): void {
    this.titleEl.setText(`Insert ${this.variable.name}`);
    const options = {
      limit: this.variable.name === "posts_by_year" ? "50" : "5",
      skip: "",
      tag: "",
      year: "",
      sort: "",
    };
    for (const key of ["limit", "skip", "tag", "year"] as const)
      new Setting(this.contentEl)
        .setName(key[0]!.toUpperCase() + key.slice(1))
        .addText((text) =>
          text.setValue(options[key]).onChange((value) => {
            options[key] = value;
          }),
        );
    new Setting(this.contentEl).setName("Sort").addDropdown((drop) =>
      drop
        .addOptions({
          "": "Default",
          newest: "Newest first",
          oldest: "Oldest first",
          alpha: "Alphabetical",
        })
        .onChange((value) => {
          options.sort = value;
        }),
    );
    const error = this.contentEl.createEl("p", { attr: { role: "alert" } });
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText("Insert")
        .setCta()
        .onClick(() => {
          try {
            this.insert({
              ...this.variable,
              source: parameterSource(this.variable.name, options),
            });
            this.close();
          } catch (e) {
            error.setText(
              e instanceof Error ? e.message : "Check the variable options.",
            );
          }
        }),
    );
  }
}
function choose(
  app: App,
  item: Variable,
  insert: (item: Variable) => void,
): void {
  if (["posts", "posts_by_year", "pages"].includes(item.name))
    new VariableParameters(app, item, insert).open();
  else insert(item);
}
export class VariablePicker extends FuzzySuggestModal<Variable> {
  constructor(
    app: App,
    private readonly editor: Editor,
    private readonly catalogue: () => readonly Variable[] = () => VARIABLES,
  ) {
    super(app);
    this.setPlaceholder("Find a OnceMarked variable");
  }
  getItems(): Variable[] {
    return [...this.catalogue()];
  }
  getItemText(item: Variable): string {
    return `${item.name} — ${item.description} · ${item.source}`;
  }
  onChooseItem(item: Variable): void {
    const from = this.editor.getCursor("from"),
      to = this.editor.getCursor("to");
    const original = this.editor.getValue();
    choose(this.app, item, (value) => {
      if (this.editor.getValue() !== original) return; // Do not insert at stale positions after a parameter dialog.
      this.editor.replaceRange(
        variableInsertion(
          value,
          original.slice(0, this.editor.posToOffset(from)),
          original.slice(this.editor.posToOffset(to)),
        ),
        from,
        to,
      );
    });
  }
}
export class VariableSuggest extends EditorSuggest<Variable> {
  constructor(
    app: App,
    private readonly catalogue: () => readonly Variable[] = () => VARIABLES,
  ) {
    super(app);
  }
  onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    _file: TFile | null,
  ): EditorSuggestTriggerInfo | null {
    if (!editor.getLine(cursor.line).slice(0, cursor.ch).includes("{{"))
      return null;
    const result = variableTrigger(
      editor.getValue(),
      editor.posToOffset(cursor),
    );
    return result
      ? {
          start: editor.offsetToPos(result.start),
          end: cursor,
          query: result.query,
        }
      : null;
  }
  getSuggestions(context: EditorSuggestContext): Variable[] {
    return this.catalogue().filter((item) =>
      `${item.name} ${item.description}`
        .toLowerCase()
        .includes(context.query.trim().toLowerCase()),
    );
  }
  renderSuggestion(item: Variable, el: HTMLElement): void {
    el.createEl("strong", { text: item.name });
    el.createDiv({ text: item.description });
  }
  selectSuggestion(item: Variable): void {
    const context = this.context;
    if (!context) return;
    const original = context.editor.getValue();
    const from = context.editor.posToOffset(context.start);
    let to = context.editor.posToOffset(context.end);
    if (original.slice(to, to + 2) === "}}") to += 2;
    this.close();
    choose(this.app, item, (value) => {
      if (context.editor.getValue() !== original) return;
      context.editor.replaceRange(
        variableInsertion(value, original.slice(0, from), original.slice(to)),
        context.start,
        context.editor.offsetToPos(to),
      );
    });
  }
}
export class CustomVariableInsert extends Modal {
  constructor(
    app: App,
    private readonly editor: Editor,
  ) {
    super(app);
  }
  onOpen(): void {
    this.titleEl.setText("Insert an existing custom variable");
    this.contentEl.createEl("p", {
      text: "Enter a variable name already defined in your OnceMarked blog. This inserts its reference; it does not create a definition.",
    });
    let name = "";
    const error = this.contentEl.createEl("p", { attr: { role: "alert" } });
    new Setting(this.contentEl).setName("Variable name").addText((text) =>
      text.onChange((value) => {
        name = value.trim();
      }),
    );
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText("Insert")
        .setCta()
        .onClick(() => {
          if (!/^[a-z][a-z_]{0,47}$/.test(name)) {
            error.setText(
              "Use 1–48 lowercase letters and underscores, starting with a letter.",
            );
            return;
          }
          this.editor.replaceSelection(`{{ ${name} }}`);
          this.close();
        }),
    );
  }
}
