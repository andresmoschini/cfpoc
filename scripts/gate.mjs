// The single definition of "green" for this repository.
//
// The pre-commit hook and CI both run `npm run check`, which runs this file, and nothing else. If
// the hook and CI ever disagree, one of them is calling something other than this, and that is the
// bug. `npm run fix` runs the subset of these steps that can repair what they find.
//
// It has no dependencies. Orchestrating a list of subprocesses and propagating their exit codes is
// what Node's standard library is for, and a tool whose job is to guard the repository should not be
// the first thing to add to it.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

/** Every step of the gate, in the order they run.
 *
 * Order is presentation only: all of them run on every invocation, so one pass reports every problem
 * rather than making you find them one at a time.
 *
 * A step passes or fails on its exit code alone. That has one known hole worth naming:
 * `wrangler deploy --dry-run` bundles without contacting Cloudflare, so `build` proves the Worker
 * compiles and its bindings resolve, and nothing about whether a real deploy would be accepted.
 */
const CHECK = [
  {
    name: "prettier",
    // Invoked from node_modules/.bin rather than through npx, which costs about a second per call
    // for nothing. Formatting and line width for Markdown, JSON, JSONC and TypeScript are decided
    // in .prettierrc.json; .editorconfig supplies indentation and line endings, so the editor and
    // this step read the same source.
    //
    // --ignore-unknown makes prettier skip file types it has no parser for instead of failing on
    // them, which matters the moment anyone passes explicit paths: without it prettier exits 2 with
    // "No parser could be inferred" for a file like .nvmrc. Those files are not unchecked:
    // editorconfig-checker reads them.
    program: "prettier",
    args: ["--check", "--ignore-unknown", "."]
  },
  {
    name: "markdownlint",
    // Globs and ignores live in .markdownlint-cli2.jsonc, so this takes no arguments and the
    // configuration has one home. It checks structure only; prettier owns formatting.
    program: "markdownlint-cli2",
    args: []
  },
  {
    name: "editorconfig",
    // With no file arguments it checks everything git would consider, so it needs no globs and no
    // ignore list of its own. It is the only step that reads .nvmrc, .gitignore and migrations/*.sql:
    // prettier cannot infer a parser for those.
    //
    // Its indent-size check is off in .editorconfig-checker.json, for the reason recorded there.
    program: "editorconfig-checker",
    args: []
  },
  {
    name: "cspell",
    // Everything tracked, not just Markdown and source: the Spanish comments in demo.http and the SQL
    // keywords are exactly the prose that rots unnoticed otherwise.
    //
    // THREE GLOBS, NOT ONE, and the reason is measured rather than guessed.
    // scripts/probe-cspell-coverage.sh puts a word no dictionary has into each tracked file in turn
    // and asks whether cspell reports it, so it answers "what does this step actually read" rather
    // than "what did someone mean". Re-run it after changing these three strings.
    //
    // `**/*` alone reaches 14 of the 33 tracked files. A leading-dot path is not matched by it, so
    // every dotfile and every dot-directory is skipped: .githooks/, .github/, .vscode/ and
    // .gitattributes itself go unchecked while the step reports success. That is the failure mode
    // worth caring about, because the step's own comment used to claim it covered everything
    // tracked.
    //
    // `.*/**` covers what is inside the dot-directories. Measured alternatives: `**/.*/**` matches
    // nothing at all, and `.*/*` reaches only the files sitting directly in a dot-directory rather
    // than the ones below it.
    //
    // `.*` covers the dotfiles sitting in the root. `.*/**` does not: with nothing after the dot it
    // matches nothing, which is why `.gitattributes` and `.gitignore` stayed unreported with two
    // globs. Measured: the three together reach 31 files, the two reach 19.
    //
    // The 2 left out are the ones cspell.json's ignorePaths names and that git tracks:
    // package-lock.json and project-words.txt. `.dev.vars`, `.env` and http-client.private.env.json
    // are named there too but are gitignored, so they are not in this count.
    //
    // --cache takes this step from about 1570 ms to about 1130 ms. Editing project-words.txt or
    // cspell.json invalidates the cache and every file is re-examined, so it cannot report success
    // from a stale result after the rules change.
    program: "cspell",
    args: ["--no-progress", "--gitignore", "--cache", "**/*", ".*/**", ".*"]
  },
  {
    name: "types",
    // tsc is the only type checker here, and it needs no flag to turn warnings into failures: it has
    // none, and --noEmit already fails on any error.
    //
    // There is no linter step. See CONTRIBUTING.md, "Pending": adding one needs a decision that has
    // not been made yet, and a placeholder would be worse than its absence.
    program: "tsc",
    args: ["--noEmit"]
  },
  {
    name: "test",
    program: "vitest",
    args: ["run"]
  },
  {
    name: "build",
    // The bundle compiles and the bindings in wrangler.jsonc resolve, without uploading anything and
    // without credentials. This is what catches a renamed D1 binding or a broken import that the
    // type checker accepts because the types still exist.
    program: "wrangler",
    args: ["deploy", "--dry-run", "--outdir", "dist"]
  }
];

/** The steps that can fix what they find, in the order they must run.
 *
 * Unlike CHECK, order here is not presentation: these steps rewrite files, so a later one can undo
 * what an earlier one wrote. The content formatters run first and editorconfig-checker last,
 * because it owns the files none of the formatters can parse.
 *
 * `cspell` has no entry: it cannot fix a spelling. `types`, `test` and `build` are checks with
 * nothing to repair.
 */
const FIX = [
  { name: "prettier", program: "prettier", args: ["--write", "--ignore-unknown", "."] },
  { name: "markdownlint", program: "markdownlint-cli2", args: ["--fix"] },
  { name: "editorconfig", program: "editorconfig-checker", args: ["-fix"] }
];

/** Whether this is Windows, which decides how the npm-installed tools are reached.
 *
 * npm ships the tools under node_modules/.bin as a shell script plus .cmd and .ps1 shims, and
 * spawnSync resolves neither an extension nor a shell the way a shell would. So on Windows the .cmd
 * has to be named and the call has to go through a shell; elsewhere the bare path runs directly.
 */
const isWindows = process.platform === "win32";

/** The command that runs `program` from the repository's own node_modules. */
function command(program) {
  const path = resolve(`node_modules/.bin/${program}${isWindows ? ".cmd" : ""}`);
  return isWindows ? `"${path}"` : path;
}

/** Runs every step in `steps`, returning the names of the ones that failed.
 *
 * Every step runs even after one fails. A gate that stops at the first problem turns one broken
 * commit into several round trips, and these steps are cheap enough that finishing is free.
 */
function runAll(steps) {
  const failed = [];

  for (const step of steps) {
    console.log(`\n--- ${step.name} ---`);

    const result = spawnSync(command(step.program), step.args, {
      stdio: "inherit",
      shell: isWindows
    });

    // status is null when the process could not start or was killed by a signal, and non-zero when
    // it exited non-zero. Neither is a pass.
    if (result.status !== 0) {
      failed.push(step.name);
    }
  }

  return failed;
}

const verb = process.argv[2] ?? "check";

if (verb !== "check" && verb !== "fix") {
  console.error(`gate: unknown command \`${verb}\``);
  console.error("\nUsage: node scripts/gate.mjs [check|fix]");
  process.exit(1);
}

const isFix = verb === "fix";
const steps = isFix ? FIX : CHECK;
const failed = runAll(steps);

if (failed.length > 0) {
  const noun = isFix ? "fixers" : "checks";
  console.error(`\n${failed.length} of ${steps.length} ${noun} failed: ${failed.join(", ")}`);
  process.exit(1);
}

console.log(
  isFix
    ? `\nall ${steps.length} fixers ran clean; run \`npm run check\` to see the whole gate`
    : `\nall ${steps.length} checks passed`
);
