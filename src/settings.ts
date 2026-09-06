import {
  PluginSettingTab,
  Setting,
  SecretComponent,
  Notice,
  type App,
  type ToggleComponent,
  type DropdownComponent,
  type SliderComponent,
  type SettingDefinitionRender,
} from "obsidian";
import { IMAGE_SIZES } from "./images";
import { defaultSettings } from "./model";
import type OnceMarkedPlugin from "./main";
import { ConfirmModal, errorMessage } from "./ui";
export class OnceMarkedSettings extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: OnceMarkedPlugin,
  ) {
    super(app, plugin);
  }
  display(): void {
    // Compatibility fallback for Obsidian 1.11–1.12. Newer hosts use definitions.
    this.containerEl.empty();
    this.renderConnections(this.containerEl);
    this.renderImages(this.containerEl);
    this.renderRecovery(this.containerEl);
  }
  getSettingDefinitions(): SettingDefinitionRender[] {
    return [
      {
        name: "Blog connections",
        aliases: [
          "Micropub endpoint",
          "App token",
          "Default blog",
          "Refresh variables",
          "Test connection",
          "Add blog",
          "Remove blog",
          "Restore blog",
        ],
        render: (setting) =>
          this.renderSection(setting, (el) => this.renderConnections(el)),
      },
      {
        name: "Image optimisation",
        aliases: [
          "Optimise images before upload",
          "Maximum image edge",
          "Image quality",
          "Compression",
          "Resize",
        ],
        render: (setting) =>
          this.renderSection(setting, (el) => this.renderImages(el)),
      },
      {
        name: "Image upload recovery",
        aliases: ["Pending image uploads", "Clear recovery data"],
        visible: () =>
          Object.values(this.plugin.data.media).some((record) => !record.url),
        render: (setting) =>
          this.renderSection(setting, (el) => this.renderRecovery(el)),
      },
    ];
  }
  private renderSection(
    setting: Setting,
    render: (el: HTMLElement) => void,
  ): void {
    // This definition contains several related controls, not a single flex row.
    setting.settingEl.empty();
    setting.settingEl.removeClass("setting-item");
    render(setting.settingEl);
  }
  private refreshSettings(): void {
    if (typeof this.update === "function") this.update();
    else {
      this.containerEl.empty();
      this.renderConnections(this.containerEl);
      this.renderImages(this.containerEl);
      this.renderRecovery(this.containerEl);
    }
  }
  private renderConnections(container: HTMLElement): void {
    container.createEl("p", {
      text: "Create a separate app token for each blog in OnceMarked → Settings → Apps. Enable create, update, read and media; also enable publish to publish or change live articles.",
    });
    const settings = this.plugin.data.settings;
    for (const blog of settings.blogs) {
      const section = container.createDiv({ cls: "om-connection" });
      new Setting(section).setName("Blog name").addText((text) =>
        text.setValue(blog.name).onChange(async (value) => {
          blog.name = value;
          await this.plugin.save();
        }),
      );
      new Setting(section).setName("Micropub endpoint").addText((text) =>
        text.setValue(blog.endpoint).onChange(async (value) => {
          blog.endpoint = value.trim();
          await this.plugin.save();
        }),
      );
      new Setting(section)
        .setName("App token")
        .setDesc("Only the secret name is stored in plugin settings.")
        .addComponent((el) =>
          new SecretComponent(this.app, el)
            .setValue(blog.tokenName)
            .onChange(async (value) => {
              blog.tokenName = value;
              await this.plugin.save();
            }),
        );
      new Setting(section)
        .addButton((button) =>
          button.setButtonText("Refresh variables").onClick(async () => {
            button.setDisabled(true);
            try {
              blog.variables = await this.plugin
                .connect(blog)
                .client.variables();
              await this.plugin.save();
              new Notice("Variable suggestions updated for this blog.");
            } catch (error) {
              new Notice(errorMessage(error));
            } finally {
              button.setDisabled(false);
            }
          }),
        )
        .addButton((button) =>
          button.setButtonText("Test connection").onClick(async () => {
            button.setDisabled(true);
            try {
              await this.plugin.connect(blog).client.config();
              new Notice(
                "Connected. Each action will check its required permissions.",
              );
            } catch (e) {
              new Notice(errorMessage(e));
            } finally {
              button.setDisabled(false);
            }
          }),
        )
        .addButton((button) =>
          button.setButtonText("Remove blog").onClick(() =>
            new ConfirmModal(
              this.app,
              "Remove blog",
              "This removes the blog from active plugin settings only. Your OnceMarked blog and posts remain. You can restore this connection below and select its app token again.",
              async () => {
                settings.removedBlogs = [
                  ...(settings.removedBlogs ?? []),
                  { ...blog, tokenName: "" },
                ];
                settings.blogs = settings.blogs.filter(
                  (item) => item.id !== blog.id,
                );
                if (settings.defaultBlog === blog.id)
                  settings.defaultBlog = settings.blogs[0]?.id ?? "";
                await this.plugin.save();
                this.refreshSettings();
              },
            ).open(),
          ),
        );
    }
    new Setting(container).addButton((button) =>
      button.setButtonText("Add blog").onClick(async () => {
        const blog = {
          id: crypto.randomUUID(),
          name: "My OnceMarked blog",
          endpoint: "https://oncemarked.com/micropub",
          tokenName: "",
        };
        settings.blogs.push(blog);
        if (!settings.defaultBlog) settings.defaultBlog = blog.id;
        await this.plugin.save();
        this.refreshSettings();
      }),
    );
    for (const removed of settings.removedBlogs ?? [])
      new Setting(container)
        .setName(`Removed blog: ${removed.name}`)
        .addButton((button) =>
          button.setButtonText("Restore blog").onClick(async () => {
            settings.blogs.push(removed);
            settings.removedBlogs = settings.removedBlogs?.filter(
              (blog) => blog.id !== removed.id,
            );
            if (!settings.defaultBlog) settings.defaultBlog = removed.id;
            await this.plugin.save();
            this.refreshSettings();
          }),
        );
    if (settings.blogs.length)
      new Setting(container).setName("Default blog").addDropdown((drop) =>
        drop
          .addOptions(
            Object.fromEntries(
              settings.blogs.map((blog) => [blog.id, blog.name]),
            ),
          )
          .setValue(settings.defaultBlog)
          .onChange(async (value) => {
            settings.defaultBlog = value;
            await this.plugin.save();
          }),
      );
  }
  private renderImages(container: HTMLElement): void {
    const settings = this.plugin.data.settings;
    const imageDefaults = defaultSettings().images;
    let optimisation: ToggleComponent;
    let maximumEdge: DropdownComponent;
    let quality: SliderComponent;
    new Setting(container)
      .setName("Optimise images before upload")
      .setDesc(
        "Resize and compress new uploads using a temporary copy. Originals stay unchanged. Previously uploaded images are reused.",
      )
      .addToggle((toggle) => {
        optimisation = toggle;
        toggle.setValue(settings.images.enabled).onChange(async (value) => {
          settings.images.enabled = value;
          await this.plugin.save();
        });
      })
      .addExtraButton((button) =>
        button
          .setIcon("rotate-ccw")
          .setTooltip("Reset to default (on)")
          .onClick(async () => {
            settings.images.enabled = imageDefaults.enabled;
            optimisation.setValue(imageDefaults.enabled);
            try {
              await this.plugin.save();
            } catch (error) {
              new Notice(errorMessage(error));
            }
          }),
      );
    new Setting(container)
      .setName("Maximum image edge")
      .addDropdown((drop) => {
        maximumEdge = drop;
        drop
          .addOptions(
            Object.fromEntries(
              IMAGE_SIZES.map((size) => [String(size), `${size} pixels`]),
            ),
          )
          .setValue(String(settings.images.maxEdge))
          .onChange(async (value) => {
            settings.images.maxEdge = Number(value);
            await this.plugin.save();
          });
      })
      .addExtraButton((button) =>
        button
          .setIcon("rotate-ccw")
          .setTooltip(`Reset to default (${imageDefaults.maxEdge} pixels)`)
          .onClick(async () => {
            settings.images.maxEdge = imageDefaults.maxEdge;
            maximumEdge.setValue(String(imageDefaults.maxEdge));
            try {
              await this.plugin.save();
            } catch (error) {
              new Notice(errorMessage(error));
            }
          }),
      );
    new Setting(container)
      .setName("Image quality")
      .setDesc(
        "Custom quality and sizes above 1600 pixels require OnceMarked Pro. Free blogs use quality 80 and a maximum of 1600 pixels.",
      )
      .addSlider((slider) => {
        quality = slider;
        slider
          .setLimits(60, 95, 1)
          .setValue(Math.round(settings.images.quality * 100))
          .onChange(async (value) => {
            settings.images.quality = value / 100;
            await this.plugin.save();
          });
      })
      .addExtraButton((button) =>
        button
          .setIcon("rotate-ccw")
          .setTooltip(
            `Reset to default (${Math.round(imageDefaults.quality * 100)})`,
          )
          .onClick(async () => {
            settings.images.quality = imageDefaults.quality;
            quality.setValue(Math.round(imageDefaults.quality * 100));
            try {
              await this.plugin.save();
            } catch (error) {
              new Notice(errorMessage(error));
            }
          }),
      );
  }
  private renderRecovery(container: HTMLElement): void {
    const pending = Object.values(this.plugin.data.media).filter(
      (record) => !record.url,
    ).length;
    if (pending)
      new Setting(container)
        .setName(`${pending} pending image upload(s)`)
        .setDesc(
          "Retry by publishing the same image with the same blog connection and image settings. Clearing recovery data can cause duplicate uploads.",
        )
        .addButton((button) =>
          button
            .setButtonText("Clear after checking image library")
            .onClick(() =>
              new ConfirmModal(
                this.app,
                "Clear image recovery",
                "First check the OnceMarked image library. This forgets pending upload requests; retrying afterward may upload another copy. Local attachments and posts are unchanged.",
                async () => {
                  for (const [key, record] of Object.entries(
                    this.plugin.data.media,
                  ))
                    if (!record.url) delete this.plugin.data.media[key];
                  await this.plugin.save();
                  this.refreshSettings();
                },
              ).open(),
            ),
        );
  }
}
