# OnceMarked for Obsidian

Publish your Obsidian notes to your [OnceMarked](https://oncemarked.com) blog. Save drafts, publish updates, turn links to published notes into blog links, compress images, and insert OnceMarked variables.

**Beta 0.1.0. Mobile support is not fully tested on iOS or Android.** Desktop publishing has been tested; device sync, interruption recovery and some permission/quota cases still need broader testing. Start with a test vault and keep a backup.

## Install

Requires Obsidian **1.11.4 or later** and a OnceMarked blog. This beta uses manual installation and is not yet in the Community plugins directory.

1. Download the plugin ZIP from this repository's Releases page once available, or build it below.
2. Extract `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/oncemarked/`.
3. Reload Obsidian and enable **OnceMarked** in **Settings → Community plugins**.
4. In your OnceMarked blog's **Settings → Apps**, create a token with **Create drafts**, **Edit posts**, **Read post source** and **Upload images**. Add **Publish and edit live posts** for public publishing.
5. In **Obsidian → Settings → OnceMarked**, add a blog using `https://oncemarked.com/micropub`. Select **Link → Add secret** to store its token in Obsidian Keychain. Each blog needs its own token.
6. Select **Test connection**, then **Refresh variables**.

Mobile requires the same files in the mobile vault and a configured token on that device; installation and publishing there are not fully tested.

## Use

Open a note and run **OnceMarked: Publish or update current note**. Choose the blog, title, slug, tags and draft/published state, then **Review** before saving or publishing. There is no automatic publishing.

Links to known published notes become working blog links. Unpublished or unresolved links require correction or explicit plain-text fallback. Renaming or moving a note preserves its publication identity; keep its `oncemarked` properties intact. Local deletion does not delete the remote post. Review remote changes before replacing them.

Image optimisation is configured globally and preserves originals. Defaults are **1600px / quality 80**. Larger sizes and custom quality require OnceMarked Pro. Local JPEG, PNG and still WebP are supported, up to 12 MiB and 40 megapixels; convert HEIC or animated images first. Insert variables with the command or by typing `{{`.

To update, close Obsidian and replace only the three plugin files. Preserve `data.json` and note properties. For interrupted operations, check the website before using **Recover pending request** or clearing recovery data. Avoid simultaneous publishing from multiple devices during the beta.

## Feedback and maintenance

[Join our Discord](https://discord.gg/uQAYAuDpVd) to connect with the OnceMarked community.

Issues and suggestions are welcome through this repository's Issues page once available. Include your device, Obsidian/plugin versions and reproduction steps. Never include tokens or private note content.

This project is maintained by its owner. **Unsolicited pull requests and external contributions are not accepted at this time.** The source is available under the MIT licence; this contribution policy does not limit the rights granted by that licence.

## Build

Use Node.js 24 and pnpm 10.

```sh
pnpm install --frozen-lockfile
pnpm package
```

The ZIP is created in `artifacts/`. Packaging runs formatting, type checks, tests and the browser-targeted build. Optional image checks: `pnpm test:images` (requires Chrome).

MIT licensed. See `LICENSE` and `THIRD-PARTY-NOTICES.txt`.
