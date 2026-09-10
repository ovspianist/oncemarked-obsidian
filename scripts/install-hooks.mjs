import { spawnSync } from "node:child_process";

const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
});

if (result.status === 0 && result.stdout.trim() === "true") {
  const configure = spawnSync(
    "git",
    ["config", "--local", "core.hooksPath", ".githooks"],
    { stdio: "inherit" },
  );
  if (configure.status !== 0)
    throw new Error("Could not configure the version-controlled Git hooks.");
  console.log("Installed OnceMarked Git hooks from .githooks/.");
}
