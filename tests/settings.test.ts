import { expect, it, vi } from "vitest";
import { defaultSettings } from "../src/model";

vi.mock("obsidian", () => ({
  PluginSettingTab: class {},
  Setting: class {
    name = "";
    slider?: { value: number; change?: (value: number) => Promise<void> };
    reset?: () => Promise<void>;
    constructor(container: { rows: unknown[] }) {
      container.rows.push(this);
    }
    setName(name: string) {
      this.name = name;
      return this;
    }
    setDesc() {
      return this;
    }
    addToggle(callback: (control: unknown) => void) {
      callback(this.control());
      return this;
    }
    addDropdown(callback: (control: unknown) => void) {
      callback(this.control());
      return this;
    }
    addSlider(callback: (control: unknown) => void) {
      const control = this.control();
      this.slider = control;
      callback(control);
      return this;
    }
    addExtraButton(callback: (control: unknown) => void) {
      const control = this.control();
      callback({
        ...control,
        onClick: (action: () => Promise<void>) => {
          this.reset = action;
          return control;
        },
      });
      return this;
    }
    control() {
      return {
        value: 0,
        change: undefined as undefined | ((value: number) => Promise<void>),
        setValue(value: number) {
          this.value = value;
          return this;
        },
        onChange(action: (value: number) => Promise<void>) {
          this.change = action;
          return this;
        },
        setLimits() {
          return this;
        },
        addOptions() {
          return this;
        },
        setIcon() {
          return this;
        },
        setTooltip() {
          return this;
        },
      };
    }
  },
  SecretComponent: class {},
  Notice: class {},
}));
vi.mock("../src/ui", () => ({ ConfirmModal: class {}, errorMessage: String }));

import { OnceMarkedSettings } from "../src/settings";
import type { App, Setting } from "obsidian";
import type OnceMarkedPlugin from "../src/main";

function fixture() {
  const plugin = {
    data: { settings: defaultSettings(), media: {} },
    save: vi.fn().mockResolvedValue(undefined),
  } as unknown as OnceMarkedPlugin;
  return { plugin, tab: new OnceMarkedSettings({} as App, plugin) };
}

it("indexes connection and image controls in modern settings search", () => {
  const { tab } = fixture();
  const definitions = tab.getSettingDefinitions();
  const searchable = definitions.flatMap((item) => [
    item.name,
    ...(item.aliases ?? []),
  ]);
  expect(searchable).toEqual(
    expect.arrayContaining([
      "App token",
      "Micropub endpoint",
      "Default blog",
      "Maximum image edge",
      "Image quality",
      "Restore blog",
      "Pending image uploads",
    ]),
  );
  expect(definitions.every((item) => typeof item.render === "function")).toBe(
    true,
  );
});

it("keeps image quality visible on initial render, slider changes and reset", async () => {
  const { tab, plugin } = fixture();
  const rows: Array<{
    name: string;
    slider?: { change?: (value: number) => Promise<void> };
    reset?: () => Promise<void>;
  }> = [];
  const element = { rows, empty: vi.fn(), removeClass: vi.fn() };
  tab
    .getSettingDefinitions()[1]!
    .render({ settingEl: element } as unknown as Setting, {} as never);
  const quality = rows.find((row) => row.name === "Image quality: 80")!;
  expect(quality).toBeDefined();
  await quality.slider!.change!(91);
  expect(quality.name).toBe("Image quality: 91");
  expect(plugin.data.settings.images.quality).toBe(0.91);
  await quality.reset!();
  expect(quality.name).toBe("Image quality: 80");
  expect(plugin.data.settings.images.quality).toBe(0.8);
});

it("only shows recovery settings when an image upload is pending", () => {
  const { tab, plugin } = fixture();
  const visible = tab.getSettingDefinitions()[2]!.visible as () => boolean;
  expect(visible()).toBe(false);
  plugin.data.media = {
    pending: { scope: "test", key: "pending", created: 0, mime: "image/webp" },
  };
  expect(visible()).toBe(true);
  plugin.data.media.pending!.url = "https://example.com/image.webp";
  expect(visible()).toBe(false);
});

it("renders a settings section in the host-provided element", () => {
  const { tab } = fixture();
  const element = { empty: vi.fn(), removeClass: vi.fn() };
  // An empty recovery section exercises the declarative wrapper without real DOM.
  tab
    .getSettingDefinitions()[2]!
    .render({ settingEl: element } as unknown as Setting, {} as never);
  expect(element.empty).toHaveBeenCalledOnce();
  expect(element.removeClass).toHaveBeenCalledWith("setting-item");
});
