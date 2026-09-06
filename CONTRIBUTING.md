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

The image integration checks require Chrome. Test publishing against a disposable
blog and vault, never a reader's data. Changes must preserve explicit review
before publication, local originals, secret storage and remote post identity.
