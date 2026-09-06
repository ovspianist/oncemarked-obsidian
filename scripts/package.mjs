import { mkdir, readFile, copyFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const pkg = JSON.parse(await readFile("package.json", "utf8"));
if (manifest.version !== pkg.version)
  throw new Error("Manifest/package versions differ.");
const output = `artifacts/oncemarked-${manifest.version}`;
await mkdir(output, { recursive: true });
const files = [
  "main.js",
  "manifest.json",
  "styles.css",
  "LICENSE",
  "README.md",
  "THIRD-PARTY-NOTICES.txt",
];
for (const name of files) await copyFile(name, `${output}/${name}`);
const checksums = await Promise.all(
  files.map(
    async (name) =>
      `${createHash("sha256")
        .update(await readFile(`${output}/${name}`))
        .digest("hex")}  ${name}`,
  ),
);
await writeFile(`${output}/SHA256SUMS`, checksums.join("\n") + "\n");
// ZIP is a build-time command only; the runtime plugin does not invoke a shell.
// Recreate the archive so removed files cannot survive from an earlier package.
await rm(`${output}.zip`, { force: true });
execFileSync("zip", [
  "-j",
  "-q",
  `${output}.zip`,
  ...files.map((name) => `${output}/${name}`),
  `${output}/SHA256SUMS`,
]);
console.log(`Packaged ${output}.zip`);
