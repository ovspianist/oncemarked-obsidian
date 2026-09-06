import { expect, it, vi } from "vitest";
import { defaultSettings } from "../src/model";

vi.mock("obsidian", () => ({
  PluginSettingTab: class {},
  Setting: class {},
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
