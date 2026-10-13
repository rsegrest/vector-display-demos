#!/usr/bin/env node
// Publishes the travel globe to a preview of ricksegrest.com — never straight to production.
//
//   npm run publish:globe [-- --dry-run]
//
// 1. Builds the standalone globe (demos/travel-globe, `build:standalone`).
// 2. In the portfolio worktree, starts a fresh branch `globe-update` from origin/master.
// 3. Replaces public/demos/travel-globe/ with the build, commits, and pushes the branch.
// Vercel then builds a preview. After checking it, make it live by fast-forwarding master to the
// branch (git push origin globe-update:master) or merging a pull request.
//
// The worktree (separate from your main checkout, so in-progress work there is never touched)
// defaults to ../../2026/portfolio-gallery-vector-globe; override with PORTFOLIO_WORKTREE.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const dryRun = process.argv.includes("--dry-run");
const root = resolve(new URL("..", import.meta.url).pathname);
const worktree = resolve(process.env.PORTFOLIO_WORKTREE ?? join(root, "../../2026/portfolio-gallery-vector-globe"));
const branch = "globe-update";
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: ["ignore", "pipe", "inherit"] }).toString().trim();
const git = (...args) => run("git", args, worktree);

if (!existsSync(join(worktree, ".git"))) {
  console.error(`No portfolio worktree at ${worktree}. Create one with:\n  git -C ~/code/2026/portfolio-gallery worktree add ${worktree} origin/master`);
  process.exit(1);
}
if (git("status", "--porcelain")) {
  console.error(`The worktree at ${worktree} has uncommitted changes; commit or discard them first.`);
  process.exit(1);
}

console.log("Building the standalone globe…");
run("npm", ["run", "build:standalone", "-w", "@vector-demos/travel-globe"]);

git("fetch", "-q", "origin");
git("switch", "-q", "-C", branch, "origin/master");
const target = join(worktree, "public/demos/travel-globe");
rmSync(target, { recursive: true, force: true });
cpSync(join(root, "demos/travel-globe/dist-standalone"), target, { recursive: true });
git("add", "-A", "public/demos/travel-globe");
if (!git("status", "--porcelain")) {
  console.log("The live globe already matches this build; nothing to publish.");
  process.exit(0);
}
git("commit", "-q", "-m", "Update the travel globe");
console.log(`Committed on ${branch}: ${git("log", "--oneline", "-1")}`);
if (dryRun) {
  console.log("Dry run: not pushing.");
  process.exit(0);
}
git("push", "-q", "--force-with-lease", "-u", "origin", branch);
console.log(`Pushed ${branch}. Vercel is building a preview (behind your Vercel login).
Find it on GitHub (the branch's deployment) or in the Vercel dashboard, check /globe, then go live with:
  git -C ${worktree} push origin ${branch}:master`);
