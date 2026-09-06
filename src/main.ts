import {
  Plugin,
  Notice,
  TFile,
  MarkdownView,
  requestUrl,
  debounce,
} from "obsidian";
import { VARIABLES, type Variable } from "./variables";
import { normaliseImageSettings } from "./images";
import { MicropubClient } from "./micropub";
import { defaultSettings, type SavedData, type BlogConnection } from "./model";
import { NoteRepository } from "./repository";
import { Publisher } from "./publisher";
import { OnceMarkedSettings } from "./settings";
import {
  VariablePicker,
  VariableSuggest,
  CustomVariableInsert,
} from "./variable-ui";
import {
  PublishModal,
  BlogPicker,
  ConfirmModal,
  RelinkModal,
  FilePicker,
  errorMessage,
} from "./ui";
export default class OnceMarkedPlugin extends Plugin {
  data: SavedData = { settings: defaultSettings(), media: {}, history: {} };
  notes!: NoteRepository;
  publisher!: Publisher;
  private externalSettingsChanged = false;
  private stopped = false;
  private saves: Promise<void> = Promise.resolve();
  variableCatalogue(): readonly Variable[] {
    const file = this.app.workspace.getActiveFile();
    const meta = file
      ? this.app.metadataCache.getFileCache(file)?.frontmatter?.oncemarked
      : undefined;
    const id = meta?.lastBlog ?? this.data.settings.defaultBlog;
    return (
      this.data.settings.blogs.find((blog) => blog.id === id)?.variables ??
      VARIABLES
    );
  }
  async onload(): Promise<void> {
    const stored: unknown = await this.loadData();
    if (stored && typeof stored === "object") {
      const value = stored as Record<string, unknown>;
      if ("settings" in value) {
        const candidate = stored as SavedData;
        if (
          !candidate.settings ||
          !Array.isArray(candidate.settings.blogs) ||
          !candidate.settings.images ||
          !candidate.media ||
          !candidate.history
        )
          throw new Error(
            "OnceMarked settings are invalid. Restore a settings backup; recovery data has not been overwritten.",
          );
        this.data = candidate;
      } else if (typeof value.endpoint === "string") {
        const id = crypto.randomUUID();
        this.data.settings.blogs = [
          {
            id,
            name: "My OnceMarked blog",
            endpoint: value.endpoint,
            tokenName:
              typeof value.tokenName === "string" ? value.tokenName : "",
          },
        ];
        this.data.settings.defaultBlog = id;
      }
    }
    this.data.settings.images = normaliseImageSettings(
      this.data.settings.images,
    );
    this.notes = new NoteRepository(this.app, this.data, () => this.save());
    this.publisher = new Publisher(
      this.notes,
      this.data,
      () => this.save(),
      (blog) => this.connect(blog),
    );
    this.addSettingTab(new OnceMarkedSettings(this.app, this));
    this.registerEditorSuggest(
      new VariableSuggest(this.app, () => this.variableCatalogue()),
    );
    this.addCommand({
      id: "insert-variable",
      name: "Insert variable",
      editorCallback: (editor) =>
        new VariablePicker(this.app, editor, () =>
          this.variableCatalogue(),
        ).open(),
    });
    this.addCommand({
      id: "insert-custom-variable",
      name: "Insert existing custom variable",
      editorCallback: (editor) =>
        new CustomVariableInsert(this.app, editor).open(),
    });
    this.addCommand({
      id: "publish",
      name: "Publish or update current note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file?.extension !== "md") return false;
        if (!checking) this.openPublish(file);
        return true;
      },
    });
    this.addRibbonIcon("send", "Publish to OnceMarked", () => {
      const file = this.app.workspace.getActiveFile();
      if (file?.extension === "md") this.openPublish(file);
      else new Notice("Open a Markdown note first.");
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && file.extension === "md")
          menu.addItem((item) =>
            item
              .setTitle("Publish to OnceMarked")
              .setIcon("send")
              .onClick(() => this.openPublish(file)),
          );
      }),
    );
    this.noteCommand("recover", "Recover pending request", (file, blog) =>
      new ConfirmModal(
        this.app,
        "Recover pending request",
        "Retry the exact saved request using its original key. This can finish publishing the saved content, even if the local note has since changed. Requests outside the safe retry window require relinking or manual reconciliation.",
        async () => {
          const url = await this.publisher.recover(file, blog);
          new Notice("Recovered the OnceMarked request.");
          this.showSaved(url);
        },
      ).open(),
    );
    this.noteCommand(
      "relink",
      "Link to an existing OnceMarked post",
      (file, blog) => new RelinkModal(this, file, blog).open(),
    );
    this.noteCommand(
      "clear-pending",
      "Clear reconciled pending request",
      (file, blog) =>
        new ConfirmModal(
          this.app,
          "Clear pending request",
          "Check OnceMarked first. If the post exists, use Link to an existing post instead. Clear only after confirming the request did not save; a later publish can create a second post otherwise.",
          async () => {
            const { meta } = await this.notes.read(file);
            if (!meta) return;
            await this.notes.mutate(file, meta.id, (note) => {
              delete note.pending[blog.id];
            });
          },
        ).open(),
    );
    this.noteCommand(
      "affected",
      "Review posts linking to this note",
      (file, blog) => {
        void (async () => {
          const { meta } = await this.notes.read(file);
          const files = meta
            ? await this.publisher.affected(meta.id, blog.id)
            : [];
          if (!files.length)
            new Notice("No tracked published articles link to this note.");
          else
            new FilePicker(this.app, files, (selected) =>
              this.openPublish(selected),
            ).open();
        })().catch((e) => new Notice(errorMessage(e)));
      },
    );
    this.addCommand({
      id: "new-copy-identity",
      name: "Give copied note a new identity",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file?.extension !== "md") return false;
        if (!checking)
          new ConfirmModal(
            this.app,
            "Give note a new identity",
            "This removes this note’s publishing associations. The original remote posts remain. Use this for an intentional copy, not to recover a lost publishing response.",
            () => this.notes.resetCopy(file),
          ).open();
        return true;
      },
    });
    const refresh = debounce(
      () => {
        void this.notes
          .rebuild()
          .catch(
            () =>
              new Notice(
                "Could not refresh the OnceMarked note index. Publishing will validate notes again.",
              ),
          );
      },
      1500,
      true,
    );
    this.register(() => refresh.cancel());
    this.app.workspace.onLayoutReady(() => refresh());
    // Files are never written or published by these listeners. Deleted-note history is retained.
    this.registerEvent(this.app.vault.on("rename", refresh));
    this.registerEvent(this.app.vault.on("create", refresh));
    this.registerEvent(this.app.vault.on("delete", refresh));
  }
  onExternalSettingsChange(): void {
    this.externalSettingsChanged = true;
    new Notice(
      "Synced OnceMarked settings changed. Reload the plugin before publishing so connections and recovery data refresh.",
      10000,
    );
  }
  onunload(): void {
    this.stopped = true;
  }
  private assertSettingsCurrent(): void {
    if (this.stopped || this.externalSettingsChanged)
      throw new Error(
        "Reload OnceMarked before continuing; its settings changed or the plugin was unloaded.",
      );
  }
  save(): Promise<void> {
    const snapshot = structuredClone(this.data);
    const operation = this.saves
      .catch(() => undefined)
      .then(() => {
        this.assertSettingsCurrent();
        return this.saveData(snapshot);
      });
    this.saves = operation;
    return operation;
  }
  connect(blog: BlogConnection): { client: MicropubClient; token: string } {
    this.assertSettingsCurrent();
    const token = this.app.secretStorage.getSecret(blog.tokenName);
    if (!token) throw new Error("Select an app token in OnceMarked settings.");
    return {
      token,
      client: new MicropubClient(blog.endpoint, token, async (request) => {
        try {
          return await requestUrl({ ...request, throw: false });
        } catch {
          throw new Error(
            "The network request did not complete. Recover a pending request before sending a new one.",
          );
        }
      }),
    };
  }
  openPublish(file: TFile): void {
    // Flush the active editor so the review uses the user's current draft rather than its older disk state.
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    void (async () => {
      if (view?.file === file) await view.save();
      new PublishModal(this, file).open();
    })().catch((error) => new Notice(errorMessage(error)));
  }
  private noteCommand(
    id: string,
    name: string,
    action: (file: TFile, blog: BlogConnection) => void,
  ): void {
    this.addCommand({
      id,
      name,
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file?.extension !== "md") return false;
        if (!checking) {
          if (!this.data.settings.blogs.length)
            new Notice("Add a blog in OnceMarked settings first.");
          else
            new BlogPicker(this.app, this.data.settings.blogs, (blog) =>
              action(file, blog),
            ).open();
        }
        return true;
      },
    });
  }
  private showSaved(url: string): void {
    const fragment = document.createDocumentFragment();
    fragment.createEl("a", {
      text: "Open in OnceMarked",
      href: url,
      attr: { target: "_blank", rel: "noopener noreferrer" },
    });
    new Notice(fragment, 10000);
  }
}
