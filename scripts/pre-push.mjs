import fs from "node:fs";
import { spawnSync } from "node:child_process";
import {
  SEMVER,
  assertInstallableAssets,
  compareVersions,
  validateReleaseMetadata,
} from "./release-policy.mjs";

const ZERO = /^0{40,64}$/;
const PUBLIC_REPOSITORY =
  /(?:github\.com[/:])ovspianist\/oncemarked-obsidian(?:\.git)?$/;
const RELEASE_RELEVANT =
  /^(?:src\/|styles\.css$|manifest\.json$|package\.json$|pnpm-lock\.yaml$|esbuild\.config\.mjs$)/;

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 && !options.allowFailure) {
    const detail = result.stderr?.trim() || result.stdout?.trim();
    throw new Error(
      `git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`,
    );
  }
  return result;
}

function output(args) {
  return git(args).stdout.trim();
}

function fail(problems) {
  console.error("\nOnceMarked pre-push checks failed:\n");
  for (const problem of problems) console.error(`- ${problem}`);
  console.error(
    "\nFix the items above, commit the fixes, and push again. Bypass with --no-verify only for an emergency you have reviewed manually.",
  );
  process.exit(1);
}

function jsonAt(commit, file) {
  try {
    return JSON.parse(output(["show", `${commit}:${file}`]));
  } catch (error) {
    throw new Error(
      `${file} at ${commit.slice(0, 12)} is missing or invalid JSON.`,
    );
  }
}

function metadataAt(commit) {
  return {
    manifest: jsonAt(commit, "manifest.json"),
    packageJson: jsonAt(commit, "package.json"),
    versions: jsonAt(commit, "versions.json"),
  };
}

function commitOf(ref) {
  return output(["rev-parse", `${ref}^{commit}`]);
}

function isAncestor(ancestor, descendant) {
  return (
    git(["merge-base", "--is-ancestor", ancestor, descendant], {
      allowFailure: true,
    }).status === 0
  );
}

function run(command, args) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const executable = process.platform === "win32" ? `${command}.cmd` : command;
  const result = spawnSync(executable, args, { stdio: "inherit" });
  if (result.status !== 0)
    fail([
      `${command} ${args.join(" ")} failed; use its output above to correct the push.`,
    ]);
}

const manual = process.argv.includes("--check-current");
const remoteName = manual ? "origin" : (process.argv[2] ?? "origin");
const remoteUrl = manual
  ? output(["remote", "get-url", remoteName])
  : (process.argv[3] ?? "");
const stdin = manual ? "" : fs.readFileSync(0, "utf8").trim();
let updates = stdin
  ? stdin.split(/\r?\n/).map((line) => {
      const [localRef, localSha, remoteRef, remoteSha] = line
        .trim()
        .split(/\s+/);
      return { localRef, localSha, remoteRef, remoteSha };
    })
  : [];

if (manual) {
  const branch = output(["symbolic-ref", "--quiet", "HEAD"]);
  const sha = output(["rev-parse", "HEAD"]);
  updates = [
    {
      localRef: branch,
      localSha: sha,
      remoteRef: branch,
      remoteSha: "0".repeat(40),
    },
  ];
}

updates = updates.filter(({ localSha }) => localSha && !ZERO.test(localSha));
if (!updates.length) process.exit(0);

const problems = [];
const dirty = output(["status", "--porcelain", "--untracked-files=all"]);
if (dirty)
  problems.push(
    "the worktree is not clean; commit or stash every change so verification tests exactly what will be pushed.",
  );

let publicMain;
if (PUBLIC_REPOSITORY.test(remoteUrl)) {
  const candidate = `refs/remotes/${remoteName}/main`;
  const result = git(["rev-parse", "--verify", candidate], {
    allowFailure: true,
  });
  if (result.status === 0) publicMain = result.stdout.trim();
  else
    problems.push(
      `cannot find ${candidate}; run git fetch ${remoteName} main before pushing to the canonical public repository.`,
    );
}

const head = output(["rev-parse", "HEAD"]);
let releaseTag;
for (const update of updates) {
  let commit;
  try {
    commit = commitOf(update.localRef);
  } catch (error) {
    problems.push(error.message);
    continue;
  }
  if (commit !== head)
    problems.push(
      `${update.localRef} does not point to the checked-out HEAD; check out that commit before pushing so verification covers the exact source.`,
    );

  let metadata;
  try {
    metadata = metadataAt(commit);
    problems.push(...validateReleaseMetadata(metadata));
  } catch (error) {
    problems.push(error.message);
    continue;
  }

  if (
    publicMain &&
    update.remoteRef !== "refs/heads/main" &&
    !isAncestor(publicMain, commit)
  )
    problems.push(
      `${update.localRef} is not based on current ${remoteName}/main; rebase it before pushing so released fixes cannot be lost.`,
    );

  if (
    update.remoteRef === "refs/heads/main" &&
    update.remoteSha &&
    !ZERO.test(update.remoteSha)
  ) {
    const changed = output([
      "diff",
      "--name-only",
      update.remoteSha,
      commit,
    ]).split("\n");
    if (changed.some((file) => RELEASE_RELEVANT.test(file))) {
      const previous = metadataAt(update.remoteSha).manifest.version;
      if (compareVersions(metadata.manifest.version, previous) <= 0)
        problems.push(
          `plugin files changed on main, so bump manifest.json and package.json above ${previous} and add the same version to versions.json before pushing.`,
        );
    }
  }

  if (update.remoteRef?.startsWith("refs/tags/")) {
    const tag = update.remoteRef.slice("refs/tags/".length);
    releaseTag = tag;
    if (!SEMVER.test(tag))
      problems.push(
        `release tag ${JSON.stringify(tag)} must use exact x.y.z semantic versioning without a "v" prefix.`,
      );
    problems.push(...validateReleaseMetadata(metadata, tag));
    const localMain = git(["rev-parse", "--verify", "refs/heads/main"], {
      allowFailure: true,
    });
    if (localMain.status !== 0 || !isAncestor(commit, localMain.stdout.trim()))
      problems.push(
        `release tag ${tag} must point to a commit reachable from local main.`,
      );
  }
}
if (problems.length) fail([...new Set(problems)]);

run("pnpm", ["verify"]);
run("pnpm", ["test:images"]);

const assetProblems = assertInstallableAssets();
if (assetProblems.length) fail(assetProblems);
console.log(
  `\nOnceMarked pre-push checks passed${releaseTag ? ` for release ${releaseTag}` : ""}.`,
);
