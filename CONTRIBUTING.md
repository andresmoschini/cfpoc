# Contributing

## Setup

```bash
npm install
git config core.hooksPath .githooks
```

The second command is not optional if you want the hooks. `core.hooksPath` is a local setting, so it
does not travel with a clone; run it once per checkout. Without it Git looks for hooks in
`.git/hooks`, which this repository does not use.

Requires Node 22.18.0, named in [.nvmrc](.nvmrc). `nvm use` reads it.

## The quality gate

`npm run check` is the whole gate, and it is the only definition of "green".

| Step           | What it checks                                                                 |
| -------------- | ------------------------------------------------------------------------------ |
| `prettier`     | Formatting of Markdown, JSON, JSONC and TypeScript, prose width included       |
| `markdownlint` | Markdown structure: heading levels, duplicate headings, bare URLs, code fences |
| `editorconfig` | Line endings, final newlines and trailing whitespace on every tracked file     |
| `cspell`       | Spelling, in code and prose alike, in English and in Spanish                   |
| `types`        | `tsc --noEmit`: the Worker and its tests typecheck                             |
| `test`         | The vitest suite                                                               |
| `build`        | The Worker bundles and its bindings resolve, without uploading                 |

Every step runs even after one fails, so a single run reports everything wrong rather than making
you fix problems one at a time. A step passes or fails on its exit code alone. That has one known
hole: `build` runs `wrangler deploy --dry-run`, which bundles without contacting Cloudflare, so it
proves the Worker compiles and nothing about whether a real deploy would be accepted.

A full run takes about 7 seconds warm and 8 cold, which is what makes it usable as a pre-commit
hook. Measured per step on Windows: `wrangler` 1955 ms, `cspell` 1575 ms cold and 1130 ms warm,
`prettier` 1064 ms, `vitest` 821 ms, `markdownlint` 654 ms, `editorconfig-checker` 339 ms, `tsc` 265
ms.

### What the spell check reads

`cspell` gets three globs, `**/*`, `.*/**` and `.*`, and all three are needed. Measured with
[scripts/probe-cspell-coverage.sh](scripts/probe-cspell-coverage.sh), which puts a word no
dictionary has into each tracked file in turn and asks whether cspell reports it.

| Globs               | Files cspell reads |
| ------------------- | ------------------ |
| `**/*`              | 14 of 33           |
| `**/*` `.*/**`      | 20 of 33           |
| `**/*` `.*/**` `.*` | 31 of 33           |

A leading dot does not match `**/*`, so every dotfile and dot-directory is skipped by it:
`.githooks/`, `.github/`, `.vscode/` and `.gitattributes` itself go unchecked while the step reports
success. `.*/**` covers what is inside the dot-directories, and `.*` covers the dotfiles in the
root, which `.*/**` does not reach because it needs something after the dot.

The 2 left out are named in `cspell.json`'s `ignorePaths`: `package-lock.json` and
`project-words.txt`. Run the probe after changing the globs. It answers what the step reads, which
is not the same question as what was intended.

### Automatic fixes

```bash
npm run fix
```

Runs `prettier`, `markdownlint` and `editorconfig` in their writing modes instead of their checking
modes, in that order: the content formatters first, and `editorconfig` last because it owns the
files none of them can parse. `npm run fix` does not guarantee `npm run check` passes afterward.
`cspell` cannot fix a spelling, and `types`, `test` and `build` have nothing to repair.

In VS Code the same thing happens on save, for the files prettier can parse. See
[.vscode/settings.json](.vscode/settings.json).

### Which tool owns which file

Two tools disagreeing about the same file is a gate that can never go green, so each concern has one
owner.

- **Markdown** is split. Prettier owns anything it can rewrite, line width included, which is why
  markdownlint's `MD013` is off: prettier guarantees the width by reflowing, while markdownlint
  could only report it and leave you to re-cut paragraphs by hand. markdownlint owns what prettier
  cannot express, like a heading level that skips or a code fence with no language.
- **TypeScript** belongs to prettier for layout and to `tsc` for everything else. There is no linter
  step; see [Pending](#pending).
- **Everything else tracked** belongs to `editorconfig-checker`: `.nvmrc`, `.gitignore`,
  `migrations/*.sql`, the files in `.githooks`, and the dotfiles prettier cannot infer a parser for.
  Its indent-size check is off in [.editorconfig-checker.json](.editorconfig-checker.json), because
  prettier uses alignment as well as indentation and an aligned continuation line is not a multiple
  of the indent size by definition.
- **`.editorconfig`** is read by prettier and by `editorconfig-checker`, so indentation and line
  endings are configured once and obeyed by both.
- **`.gitattributes`** decides line endings for Git, which is the third reader of the same concern
  and the one that refuses a CRLF file rather than converting it.

### When a check fails

- **`cspell` flags a word.** Decide which it is. A misspelling gets fixed. A genuine term that
  neither dictionary knows goes in [project-words.txt](project-words.txt). A Spanish word belongs
  there only when the Spanish dictionary genuinely lacks it: a Spanish typo is still a typo and gets
  fixed.
- **`cspell` flags a shell keyword in `.githooks/`.** It should not: `cspell.json` loads the shell
  word list, because those files carry no extension and cspell would otherwise read them as plain
  text. If it does, the dictionary path in `cspell.json` is wrong.
- **The gate fails on a file you did not touch.** Check the line endings. `git add --renormalize .`
  applies `.gitattributes` to what is already tracked, and it is the fix for a file that was
  committed with CRLF before the rule existed.

## Pending

### A linter

There is no ESLint step, on purpose rather than by omission. `typescript-eslint@8.71.0` declares
`typescript >=4.8.4 <6.1.0` as its peer range and this project is on `typescript@7.0.2`, so
`npm install typescript-eslint` fails with `ERESOLVE`. Installing it with `--legacy-peer-deps` would
get a tree that npm does not consider supported, and the failure mode of that is a lint rule
silently reading the wrong AST rather than an error.

<!-- Three words in this file are not English and are not worth a dictionary entry for the whole
     repository: ERESOLVE is npm's own code for an unresolvable dependency tree, OPENCODE is the name
     of this harness, and Wqgrkgi is a fragment of a real session id quoted below. -->
<!-- cspell:ignore ERESOLVE OPENCODE Wqgrkgi -->

When `typescript-eslint` widens its range to include TypeScript 7, add it as a `lint` step in
[scripts/gate.mjs](scripts/gate.mjs) and put its rules in a flat `eslint.config.js`. Until then,
`tsc --strict` is the only static check the TypeScript gets.

A biome-based linter would work today and would replace prettier rather than sit beside it. That is
a different decision from the one recorded here, and it is not taken.

## The hooks

`pre-commit` runs the gate. `commit-msg` stamps the session trailer and then checks the message with
commitlint. Both live in `.githooks/` and both are installed by
`git config core.hooksPath .githooks`.

`pre-commit` has a known limitation: it checks the working tree, not the staged snapshot. With
unstaged changes present, or after `git add -p`, it verifies files that are not exactly the ones
being committed, so a commit can pass the hook and still be broken. Stashing to fix that risks
losing work when the hook is interrupted, which is a worse failure than the one it prevents. CI is
the enforcement boundary; the hook is fast feedback, not the guarantee.

### The session trailer

`commit-msg` appends:

```text
OpenCode-Session: ses_f07f7ce68ffe8E1Wqgrkgi4Snv
```

The id above is one real session's, kept so the shape is visible; yours will differ. To see yours:

```bash
echo "$OPENCODE_SESSION_ID"
```

That variable is what the hook reads. This harness exports it into the environment of the shells it
spawns, so `git commit` running as a child of one of those shells passes it down to the hook, and
the value inherited is always the session that is committing.

Three things are worth knowing about it:

- It is written as a trailer, not as a free-standing line, because a line that is not a trailer at
  the end of a message invalidates the whole block.
- `--if-exists doNothing` keeps `git commit --amend` from stamping a second, different value.
- When the variable is absent, or malformed, nothing is stamped and the commit proceeds. A commit
  with no trailer is fine. A commit carrying somebody else's is not, and failing the commit over
  this would be worse than either.

The guard that decides whether to stamp is tested:

```bash
sh scripts/test-session-guard.sh
```

It reads the guard out of the hook and runs it against 16 values, so it cannot drift from the
pattern it is checking. Add a value there when the id format changes.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), checked by commitlint in the
`commit-msg` hook. A subject reads `type: summary`:

```text
feat: accept an ISO timestamp with an offset
```

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs `npm run check` on every push to `main`
and every pull request. It calls the same entry point the hook does, so the two cannot disagree.

## Deploying

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) is manual: open the Actions tab, pick
**Deploy**, and press **Run workflow**. It publishes the selected ref, which defaults to `main`.

It is manual on purpose. `wrangler deploy` promotes a version atomically and can be rolled back. A
D1 migration cannot be, and deploying the previous commit does not undo one. A deploy that fired on
merge would have two failure modes with very different recoveries: the Worker version is wrong for a
few minutes, or the schema is wrong and the old Worker no longer runs against it. Only the first is
self-healing.

The workflow still runs `npm run check` before deploying. CI already gates every push, so it could
trust that verdict, but it can also be dispatched against a commit whose CI run has not finished or
was cancelled, and publishing then would mean trusting a check that never reported.

### The `apply_migrations` input

Off by default. Ticking it applies every pending D1 migration to the remote database before the
deploy. The workflow prints the list of pending migrations first, so the tick is informed. Wrangler
applies each migration in its own transaction and records it, so a failure part-way leaves the
earlier ones applied: read the list before ticking it.

Migrations also stay available by hand:

```bash
npm run db:migrate:remote
```

### What has to be configured once, in GitHub

Under **Settings → Environments**, create an environment named `production`:

| Kind     | Name                    | Value                                              |
| -------- | ----------------------- | -------------------------------------------------- |
| Secret   | `CLOUDFLARE_API_TOKEN`  | An API token with Account → Workers Scripts → Edit |
| Secret   | `CLOUDFLARE_ACCOUNT_ID` | `e03df910670b7af814f102cdcfc0996b`                 |
| Variable | `WORKER_URL`            | `https://cfpoc.andresmoschini.workers.dev`         |

`CLOUDFLARE_ACCOUNT_ID` is not really a secret; it is the account id from the Cloudflare dashboard
and it is already in the D1 entry in `wrangler.jsonc`. It is named as a secret here so the workflow
and the configuration cannot drift apart on it.

`WORKER_URL` is used for the health check after the deploy. The environment name is what attaches
required reviewers later, without moving the credentials anywhere.

### The production token is not in GitHub

`EVENTS_API_TOKEN` lives in Cloudflare as a Wrangler secret, which is environment-level rather than
version-level. A deploy neither carries it nor can delete it, so there is no application secret to
rotate in this repository and nothing to leak through a workflow log.
