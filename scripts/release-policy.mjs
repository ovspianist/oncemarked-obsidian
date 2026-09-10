import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function validateReleaseMetadata(
  { manifest, packageJson, versions },
  expectedTag,
) {
  const problems = [];
  const version = manifest.version;
  if (typeof version !== "string" || !SEMVER.test(version))
    problems.push(
      'manifest.json "version" must use exact x.y.z semantic versioning (for example, 0.1.5).',
    );
  if (packageJson.version !== version)
    problems.push(
      `package.json version (${String(packageJson.version)}) must match manifest.json (${String(version)}).`,
    );
  if (expectedTag && expectedTag !== version)
    problems.push(
      `release tag (${expectedTag}) must exactly match manifest.json (${String(version)}); do not prefix the tag with "v".`,
    );
  if (!manifest.minAppVersion || !SEMVER.test(manifest.minAppVersion))
    problems.push(
      'manifest.json "minAppVersion" must use exact x.y.z semantic versioning.',
    );
  if (version && versions[version] !== manifest.minAppVersion)
    problems.push(
      `versions.json must contain ${JSON.stringify(version)}: ${JSON.stringify(manifest.minAppVersion)}.`,
    );
  for (const field of ["id", "name", "description", "author"]) {
    if (typeof manifest[field] !== "string" || !manifest[field].trim())
      problems.push(
        `manifest.json requires a non-empty ${JSON.stringify(field)}.`,
      );
  }
  if (manifest.id !== "oncemarked")
    problems.push('manifest.json "id" must remain "oncemarked".');
  return problems;
}

export function readReleaseMetadata(root = process.cwd()) {
  const read = (file) =>
    JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  return {
    manifest: read("manifest.json"),
    packageJson: read("package.json"),
    versions: read("versions.json"),
  };
}

export function assertInstallableAssets(root = process.cwd()) {
  const problems = [];
  for (const file of ["main.js", "manifest.json", "styles.css"]) {
    const target = path.join(root, file);
    if (!fs.existsSync(target) || fs.statSync(target).size === 0)
      problems.push(
        `${file} must exist and be non-empty; run pnpm build before creating a release tag.`,
      );
  }
  return problems;
}

function runCli() {
  const expectedTag = process.argv.find((value) => SEMVER.test(value));
  const checkAssets = process.argv.includes("--assets");
  const problems = validateReleaseMetadata(readReleaseMetadata(), expectedTag);
  if (checkAssets) problems.push(...assertInstallableAssets());
  if (problems.length) {
    console.error("Release policy failed:\n");
    for (const problem of problems) console.error(`- ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Release metadata is valid${expectedTag ? ` for tag ${expectedTag}` : ""}${checkAssets ? "; installable assets are present" : ""}.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) runCli();
