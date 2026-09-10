# OnceMarked for Obsidian

Publish your Obsidian notes to your [OnceMarked](https://oncemarked.com) blog. Save drafts, publish updates, turn links to published notes into blog links, compress images, and insert OnceMarked variables.

**Early release 0.1.4. Mobile support is not fully tested on iOS or Android.** Desktop publishing has been tested; device sync, interruption recovery and some permission/quota cases still need broader testing. Start with a test vault and keep a backup.

## Account, payment and network access

The plugin is free and open source. Publishing requires a OnceMarked account and blog. OnceMarked offers a Free plan; larger storage allowances and advanced features require a paid Pro plan. See [plans](https://oncemarked.com/blogs/pro).

The plugin connects to your configured OnceMarked Micropub endpoint to check permissions, retrieve post source and variables, upload selected images, and create or update posts. Publishing sends the reviewed note content, metadata and selected images to OnceMarked using your blog's app token. It does not automatically publish your vault. An internet connection is required for these operations; ordinary local writing remains available offline.

## Install

Requires Obsidian **1.11.4 or later** and a OnceMarked blog. Install [OnceMarked from the Community directory](https://community.obsidian.md/plugins/oncemarked), or find **OnceMarked** in **Settings → Community plugins → Browse**. Install and enable it, then follow **Connect your blog** below.

For manual installation:

1. Download `main.js`, `manifest.json` and `styles.css` from this repository's Releases page, or build them below.
2. Place the three files into `<vault>/.obsidian/plugins/oncemarked/`.
3. Reload Obsidian and enable **OnceMarked** in **Settings → Community plugins**.

## Connect your blog

The app token (the “secret” Obsidian asks for) comes from your **blog's settings on the OnceMarked website**, not your OM profile settings or Obsidian settings.

1. Sign in at [OnceMarked](https://oncemarked.com) and open your **blog dashboard**. Create a blog first if you don't have one, or select the blog you want to publish to.
2. Inside that blog's dashboard, open **Settings → Apps → Create token**. Give it a name such as “Obsidian”.
3. Enable **Create drafts**, **Edit posts**, **Read post source** and **Upload images**. Also enable **Publish and edit live posts** if you want to publish publicly or update live posts. Create the token and copy it; keep it private.
4. Switch back to **Obsidian → Settings → OnceMarked → Add blog**. Enter a name and use `https://oncemarked.com/micropub` as the Micropub endpoint.
5. Under **App token**, select **Link → Add secret**. Give the secret a name, paste the copied token as its value, and select that secret for this blog. Obsidian Keychain stores the token; each blog needs its own token.
6. Select **Test connection**, then **Refresh variables**.

Mobile requires the plugin and a configured token on that device; installation and publishing there are not fully tested.

## Use

Open a note and run **OnceMarked: Publish or update current note**. Choose the blog, title, slug, tags and draft/published state, then **Review** before saving or publishing. There is no automatic publishing.

Links to known published notes become working blog links. Unpublished or unresolved links require correction or explicit plain-text fallback. Renaming or moving a note preserves its publication identity; keep its `oncemarked` properties intact. Local deletion does not delete the remote post. Review remote changes before replacing them.

### Manual sync from OnceMarked

For a linked note, run **OnceMarked: Sync current note from OnceMarked** and choose its blog. The plugin compares the note, the current OnceMarked post and their last synchronized version. A remote-only edit can update the note directly. Independent edits on both sides are combined automatically. Overlapping edits are inserted into the note between standard `<<<<<<< Obsidian`, `=======` and `>>>>>>> OnceMarked` conflict markers.

Edit the candidates in place and remove all marker lines before publishing. Publishing is blocked while markers remain. **Restore note from before OnceMarked sync** restores the recovery copy retained while a merge is unresolved. Successful publication clears that recovery state.

The sync refreshes title, slug, tags, publication status and the current post address without renaming the note or rewriting unrelated frontmatter. Hosted OnceMarked images use full blog URLs inside Obsidian and become portable media paths again when republished. Older associations without a common snapshot show both complete bodies for their first overlapping conflict; a successful publish or sync enables localized three-way merges afterward. Synchronization only runs when you invoke the command.

Image optimisation is configured globally and preserves originals. Defaults are **1600px / quality 80**. Larger sizes and custom quality require OnceMarked Pro. Local JPEG, PNG and still WebP are supported, up to 12 MiB and 40 megapixels; convert HEIC or animated images first. Insert variables with the command or by typing `{{`.

Update through **Settings → Community plugins**. For manual installations, close Obsidian and replace only the three plugin files. Preserve `data.json` and note properties. For interrupted operations, check the website before using **Recover pending request** or clearing recovery data. Avoid simultaneous publishing from multiple devices during the beta.

## Feedback and maintenance

[Join our Discord](https://discord.gg/uQAYAuDpVd) to connect with the OnceMarked community.

Issues and suggestions are welcome through this repository's Issues page once available. Include your device, Obsidian/plugin versions and reproduction steps. Never include tokens or private note content.

This project is maintained by its owner. **Unsolicited pull requests and external contributions are not accepted at this time.** The source is available under the MIT licence; this contribution policy does not limit the rights granted by that licence.

This public repository is the source of truth for ongoing development and releases.
The earlier private repository is an archive, not an upstream export source.

See [contribution and testing guidelines](CONTRIBUTING.md). The plugin enumerates
vault paths locally to resolve note links. Base64 encoding preserves binary image
payloads for interrupted-upload recovery; it is not code obfuscation.

## Build

Use Node.js 24 and pnpm 10.

```sh
pnpm install --frozen-lockfile
pnpm package
```

The ZIP is created in `artifacts/`. Packaging runs formatting, type checks, tests and the browser-targeted build. Optional image checks: `pnpm test:images` (requires Chrome).

Tagged releases are built and attested in GitHub Actions. Only the three installable
plugin files are attached to new releases; documentation and licences remain in
the repository and local ZIP. Verify downloaded assets with `gh attestation verify
main.js --repo ovspianist/oncemarked-obsidian` (and likewise for `styles.css`).

MIT licensed. See `LICENSE` and `THIRD-PARTY-NOTICES.txt`.
