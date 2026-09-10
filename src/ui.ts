import {
  Modal,
  Setting,
  FuzzySuggestModal,
  type App,
  type TFile,
  Notice,
} from "obsidian";
import type OnceMarkedPlugin from "./main";
import type { BlogConnection } from "./model";
import type { PublishInput, Review, SyncReview } from "./publisher";
export function errorMessage(error: unknown): string {
  // Transport failures may carry request details; show only our controlled errors.
  return error instanceof Error &&
    (error.name === "Error" || error.name === "MicropubError") &&
    !/https?:|Bearer|token_/.test(error.message)
    ? error.message
    : "The request failed. Check your network and connection settings. Recover a pending request before trying a new one.";
}
export class PublishModal extends Modal {
  constructor(
    private readonly plugin: OnceMarkedPlugin,
    private readonly file: TFile,
  ) {
    super(plugin.app);
  }
  onOpen(): void {
    this.titleEl.setText("Publish to OnceMarked");
    void this.render().catch((error) => {
      this.contentEl.createEl("p", {
        text: errorMessage(error),
        attr: { role: "alert" },
      });
    });
  }
  private async render(): Promise<void> {
    const blogs = this.plugin.data.settings.blogs;
    if (!blogs.length) {
      this.contentEl.createEl("p", {
        text: "Add a blog in OnceMarked plugin settings first.",
      });
      return;
    }
    const note = await this.plugin.notes.read(this.file);
    let blog =
      blogs.find((b) => b.id === note.meta?.lastBlog) ??
      blogs.find((b) => !!note.meta?.posts[b.id]) ??
      blogs.find((b) => b.id === this.plugin.data.settings.defaultBlog) ??
      blogs[0]!;
    let review: Review | undefined;
    let overwrite = false;
    const input: PublishInput = {
      title: "",
      slug: "",
      tags: [],
      state: "draft",
      plainUnpublished: false,
    };
    const form = this.contentEl.createEl("fieldset", { cls: "om-form" });
    form.addEventListener(
      "click",
      (event) => {
        if (form.disabled) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );
    const fields = form.createDiv();
    const result = form.createDiv();
    const status = this.contentEl.createEl("p", {
      attr: { role: "status", "aria-live": "polite" },
    });
    const invalidate = () => {
      review = undefined;
      overwrite = false;
      result.empty();
    };
    const load = () => {
      invalidate();
      fields.empty();
      const binding = note.meta?.posts[blog.id];
      input.title =
        binding?.title ||
        (typeof note.properties.title === "string"
          ? note.properties.title
          : this.file.basename);
      input.slug =
        binding?.slug ??
        (typeof note.properties.slug === "string" ? note.properties.slug : "");
      input.tags =
        binding?.tags ??
        (Array.isArray(note.properties.tags)
          ? note.properties.tags.filter(
              (t): t is string => typeof t === "string",
            )
          : typeof note.properties.tags === "string"
            ? note.properties.tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
            : []);
      input.state = binding?.state ?? "draft";
      new Setting(fields).setName("Blog").addDropdown((drop) =>
        drop
          .addOptions(Object.fromEntries(blogs.map((b) => [b.id, b.name])))
          .setValue(blog.id)
          .onChange((value) => {
            blog = blogs.find((b) => b.id === value)!;
            load();
          }),
      );
      for (const [key, title] of [
        ["title", "Title"],
        ["slug", "URL slug"],
      ] as const)
        new Setting(fields).setName(title).addText((text) =>
          text.setValue(input[key]).onChange((value) => {
            input[key] = value;
            invalidate();
          }),
        );
      new Setting(fields).setName("Tags").addText((text) =>
        text.setValue(input.tags.join(", ")).onChange((value) => {
          input.tags = value
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
          invalidate();
        }),
      );
      new Setting(fields).setName("Publication state").addDropdown((drop) =>
        drop
          .addOptions({ draft: "Draft", published: "Published" })
          .setValue(input.state)
          .onChange((value) => {
            input.state = value as "draft" | "published";
            invalidate();
          }),
      );
      if (binding?.state === "published")
        fields.createEl("p", {
          text: "Updating changes the live article. Choosing Draft removes it from publication.",
        });
      new Setting(fields)
        .setName("Unpublished note links")
        .setDesc(
          "When enabled, unresolved or unpublished note links become plain text. They are never published as private editor links.",
        )
        .addToggle((toggle) =>
          toggle.setValue(input.plainUnpublished).onChange((value) => {
            input.plainUnpublished = value;
            invalidate();
          }),
        );
      new Setting(fields).addButton((button) =>
        button
          .setButtonText("Review")
          .setCta()
          .onClick(async () => {
            form.disabled = true;
            status.setText("Checking note, links and remote post…");
            try {
              review = await this.plugin.publisher.review(
                this.file,
                blog,
                input,
              );
              result.empty();
              for (const issue of review.prepared.issues)
                result.createEl("p", { text: issue, cls: "om-error" });
              result.createEl("p", {
                text: `${review.images.size} local image(s) to prepare. ${review.prepared.dependencies.length} linked note(s).`,
              });
              if (review.conflict) {
                result.createEl("p", {
                  text: "The OnceMarked post differs from your last recorded version. Compare it before replacing it.",
                  cls: "om-error",
                });
                const remote = result.createEl("details");
                remote.createEl("summary", {
                  text: "Current remote content and metadata",
                });
                remote.createEl("pre", {
                  text: JSON.stringify(review.remote, null, 2),
                  cls: "om-source",
                });
                new Setting(result)
                  .setName("Replace the remote version shown above")
                  .addToggle((toggle) =>
                    toggle.onChange((value) => {
                      overwrite = value;
                    }),
                  );
              }
              const preview = result.createEl("details");
              preview.createEl("summary", {
                text: "Outgoing Markdown (images use temporary addresses until upload)",
              });
              preview.createEl("pre", {
                text: review.prepared.markdown,
                cls: "om-source",
              });
              if (!review.prepared.issues.length)
                new Setting(result).addButton((send) =>
                  send
                    .setButtonText(
                      binding
                        ? input.state === "draft"
                          ? "Update as draft"
                          : "Update published post"
                        : input.state === "draft"
                          ? "Save draft"
                          : "Publish post",
                    )
                    .setCta()
                    .onClick(async () => {
                      if (!review) return;
                      form.disabled = true;
                      try {
                        const url = await this.plugin.publisher.publish(
                          this.file,
                          blog,
                          review,
                          overwrite,
                          (message) => status.setText(message),
                        );
                        this.contentEl.empty();
                        this.contentEl.createEl("p", {
                          text: "Saved to OnceMarked.",
                        });
                        this.contentEl.createEl("a", {
                          text: "Open in OnceMarked",
                          href: url,
                          attr: {
                            target: "_blank",
                            rel: "noopener noreferrer",
                          },
                        });
                        const affected = await this.plugin.publisher.affected(
                          review.noteId,
                          blog.id,
                        );
                        if (affected.length)
                          new Setting(this.contentEl)
                            .setName(
                              `${affected.length} linked article(s) may need refreshing`,
                            )
                            .addButton((button) =>
                              button
                                .setButtonText("Review affected posts")
                                .onClick(() =>
                                  new FilePicker(this.app, affected, (file) => {
                                    this.close();
                                    this.plugin.openPublish(file);
                                  }).open(),
                                ),
                            );
                      } catch (error) {
                        status.setText(errorMessage(error));
                      } finally {
                        form.disabled = false;
                      }
                    }),
                );
              status.setText(
                review.prepared.issues.length
                  ? "Resolve the checks and review again."
                  : "Review ready. Nothing has been uploaded yet.",
              );
            } catch (error) {
              status.setText(errorMessage(error));
            } finally {
              form.disabled = false;
            }
          }),
      );
      if (note.meta?.pending[blog.id])
        fields.createEl("p", {
          text: "A saved request is pending. Use OnceMarked: Recover pending request from the command palette.",
        });
    };
    load();
  }
}
export class SyncModal extends Modal {
  constructor(
    private readonly plugin: OnceMarkedPlugin,
    private readonly file: TFile,
    private readonly blog: BlogConnection,
  ) {
    super(plugin.app);
  }
  onOpen(): void {
    this.titleEl.setText("Sync from OnceMarked");
    const status = this.contentEl.createEl("p", {
      text: "Comparing the note with OnceMarked…",
      attr: { role: "status", "aria-live": "polite" },
    });
    void this.plugin.publisher
      .syncReview(this.file, this.blog)
      .then((review) => this.render(review, status))
      .catch((error) => status.setText(errorMessage(error)));
  }
  private render(review: SyncReview, status: HTMLParagraphElement): void {
    const descriptions: Record<SyncReview["state"], string> = {
      "up-to-date": "The note and OnceMarked post are up to date.",
      "local-ahead": "This note has changes that have not been published.",
      "remote-ahead":
        "The OnceMarked post changed. It can update this note safely.",
      merged:
        "Both versions changed in different places. They can be merged without conflict markers.",
      conflict: `${review.conflicts} overlapping change${review.conflicts === 1 ? "" : "s"} need resolution in the note.`,
    };
    status.setText(descriptions[review.state]);
    if (review.metadataChanged) {
      const details = this.contentEl.createEl("details");
      details.createEl("summary", { text: "OnceMarked publishing details" });
      const list = details.createEl("dl", { cls: "om-sync-meta" });
      for (const [label, value] of [
        ["Title", String(review.remote.name?.[0] ?? "")],
        ["Slug", String(review.remote["mp-slug"]?.[0] ?? "")],
        ["Status", String(review.remote["post-status"]?.[0] ?? "")],
        ["Tags", (review.remote.category ?? []).join(", ")],
      ]) {
        list.createEl("dt", { text: label });
        list.createEl("dd", { text: value });
      }
    }
    if (["remote-ahead", "merged", "conflict"].includes(review.state)) {
      const preview = this.contentEl.createEl("details");
      preview.createEl("summary", {
        text:
          review.state === "conflict"
            ? "Preview conflict candidates"
            : "Preview updated note",
      });
      preview.createEl("pre", { text: review.markdown, cls: "om-source" });
    }
    if (review.legacy)
      this.contentEl.createEl("p", {
        text:
          review.state === "conflict"
            ? "This older association has no common snapshot, so the first conflict contains both complete bodies. Future conflicts will be localized."
            : "Saving this comparison enables precise three-way merges for future edits.",
      });
    const actionable =
      !["up-to-date", "local-ahead"].includes(review.state) || review.legacy;
    if (!actionable) return;
    const labels: Record<SyncReview["state"], string> = {
      "up-to-date": review.legacy ? "Enable three-way sync" : "Done",
      "local-ahead": "Enable three-way sync",
      "remote-ahead": "Update note from OnceMarked",
      merged: "Merge changes into note",
      conflict: "Insert conflict candidates",
    };
    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => this.close()),
      )
      .addButton((button) =>
        button
          .setButtonText(labels[review.state])
          .setCta()
          .onClick(async () => {
            button.setDisabled(true);
            try {
              await this.plugin.publisher.applySync(
                this.file,
                this.blog,
                review,
              );
              this.close();
              new Notice(
                review.state === "conflict"
                  ? "Conflict candidates inserted. Delete the unwanted lines and all three marker lines before publishing."
                  : review.state === "merged"
                    ? "OnceMarked changes merged. Publish when the combined note is ready."
                    : review.state === "remote-ahead"
                      ? "Note updated from OnceMarked."
                      : "Three-way sync baseline saved.",
                10000,
              );
            } catch (error) {
              status.setText(errorMessage(error));
              button.setDisabled(false);
            }
          }),
      );
  }
}
export class FilePicker extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly files: TFile[],
    private readonly choose: (file: TFile) => void,
  ) {
    super(app);
    this.setPlaceholder("Choose an article to review and update");
  }
  getItems(): TFile[] {
    return this.files;
  }
  getItemText(file: TFile): string {
    return file.path;
  }
  onChooseItem(file: TFile): void {
    this.choose(file);
  }
}
export class BlogPicker extends FuzzySuggestModal<BlogConnection> {
  constructor(
    app: App,
    private readonly blogs: BlogConnection[],
    private readonly choose: (blog: BlogConnection) => void,
  ) {
    super(app);
    this.setPlaceholder("Choose a OnceMarked blog");
  }
  getItems(): BlogConnection[] {
    return this.blogs;
  }
  getItemText(blog: BlogConnection): string {
    return blog.name;
  }
  onChooseItem(blog: BlogConnection): void {
    this.choose(blog);
  }
}
export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly title: string,
    private readonly explanation: string,
    private readonly action: () => Promise<void>,
  ) {
    super(app);
  }
  onOpen(): void {
    this.titleEl.setText(this.title);
    this.contentEl.createEl("p", { text: this.explanation });
    const error = this.contentEl.createEl("p", { attr: { role: "alert" } });
    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => this.close()),
      )
      .addButton((button) =>
        button.setButtonText(this.title).onClick(async () => {
          button.setDisabled(true);
          try {
            await this.action();
            this.close();
          } catch (e) {
            error.setText(errorMessage(e));
            button.setDisabled(false);
          }
        }),
      );
  }
}
export class RelinkModal extends Modal {
  constructor(
    private readonly plugin: OnceMarkedPlugin,
    private readonly file: TFile,
    private readonly blog: BlogConnection,
  ) {
    super(plugin.app);
  }
  onOpen(): void {
    this.titleEl.setText("Link to an existing OnceMarked post");
    this.contentEl.createEl("p", {
      text: "This replaces this note’s association for the selected blog and clears its pending post request. It does not change the remote post. Confirm this is the intended post before linking.",
    });
    let url = "";
    const error = this.contentEl.createEl("p", { attr: { role: "alert" } });
    new Setting(this.contentEl).setName("Post address").addText((text) =>
      text.onChange((value) => {
        url = value.trim();
      }),
    );
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText("Link post")
        .setCta()
        .onClick(async () => {
          button.setDisabled(true);
          try {
            await this.plugin.publisher.relink(this.file, this.blog, url);
            this.close();
          } catch (e) {
            error.setText(errorMessage(e));
            button.setDisabled(false);
          }
        }),
    );
  }
}
