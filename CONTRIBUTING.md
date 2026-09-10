# Contributing

OnceMarked is currently maintained by its owner. Unsolicited pull requests and
external code contributions are not accepted at this time. The MIT licence still
permits you to use, modify and redistribute the source under its terms.

Bug reports and suggestions are welcome through GitHub Issues or the community
Discord linked in the README. Include your Obsidian version, plugin version,
operating system, reproduction steps and expected behavior. Use a test vault and
remove tokens, private notes and personal information from reports.

For local development, use Node.js 24 and pnpm 10, then run:

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm test:images
```

`pnpm install` configures the repository's version-controlled pre-push hook. The
hook rejects dirty or stale branches, validates release metadata, and runs the
checks above against the exact checked-out commit. Run `pnpm prepush:check` to
exercise it before a push, or `pnpm hooks:install` to restore it after changing
Git configuration.

Feature branches may keep the current released version. A push to `main` that
changes plugin files must increment the exact `x.y.z` version in `manifest.json`
and `package.json` and add that version to `versions.json`. A release tag must
exactly match those files without a `v` prefix. GitHub Actions reuses the same
release metadata check and publishes only `main.js`, `manifest.json` and
`styles.css`.

The image integration checks require Chrome. Test publishing against a disposable
blog and vault, never a reader's data. Changes must preserve explicit review
before publication, local originals, secret storage and remote post identity.
