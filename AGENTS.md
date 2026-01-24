# AGENTS

This file is for AI agents and automation working in this repo. Keep human-facing content in README.md for readability and SEO.

## AI Metadata

```yaml
project: auto-cr
repo: https://github.com/wangweiwei/auto-cr
packages:
  - auto-cr-cmd
  - auto-cr-rules
languages: [JavaScript, TypeScript]
cli: "npx auto-cr-cmd --language en <path>"
outputs: [text, json]
config_files: [.autocrrc.json, .autocrrc.js]
ignore_files: [.autocrignore.json, .autocrignore.js]
```

## CLI Behavior (structured)

```yaml
cli_options:
  - flag: --language
    values: [zh, en]
    default: LANG env (fallback zh)
  - flag: --output
    values: [text, json]
    default: text
  - flag: --progress
    values: [tty-only, yes, no]
    default: no
  - flag: --stdin
    note: "reads when piped; supports newline or NUL separators"
  - flag: --rule-dir
  - flag: --config
  - flag: --ignore-path
  - flag: --tsconfig
scan:
  extensions: [.ts, .tsx, .js, .jsx]
  skip_dts: true
  directory_scan_skips: [node_modules]
  stdin_auto_read_when_piped: true
output:
  text: stderr
  json: stdout
exit_codes:
  ok: 0
  errors_or_fatal: 1
custom_rules:
  extensions: [.js, .cjs, .mjs]
  exports: [rule, rules, default, array]
env:
  AUTO_CR_WORKERS: "0/1 single-thread; >1 sets worker count; default CPU-1 when files >= 20"
```

## Repo Layout

- `packages/auto-cr-cmd`: CLI implementation (entry: `packages/auto-cr-cmd/src/index.ts`).
- `packages/auto-cr-rules`: Rule SDK + built-in rules (rules in `packages/auto-cr-rules/src/rules`, messages in `packages/auto-cr-rules/src/messages.ts`).
- `docs/`: Configuration + rule docs.
- `examples/`: Example projects and rule demos.
- `scripts/`: Workspace utilities, including README syncing.

## Common Commands

- Install deps: `pnpm install` (workspace uses `pnpm@10.15.1`).
- Build all: `pnpm run build`
- Build all (force): `pnpm run build:force`
- Dev/watch CLI: `pnpm run dev`
- Run CLI in TS: `pnpm run cli`

## User-Facing Config

- `.autocrrc.json` / `.autocrrc.js` for rule settings (see `docs/config.md`).
- `.autocrignore.json` / `.autocrignore.js` for ignore patterns (see `docs/config.md`).
- `tsconfig.json` is used to infer parser options; override with `--tsconfig`.

## Notes for Changes

- New built-in rule: add file in `packages/auto-cr-rules/src/rules`, export it in `packages/auto-cr-rules/src/rules/index.ts`, add messages in `packages/auto-cr-rules/src/messages.ts`, and add docs under `docs/`.
- CLI flags live in `packages/auto-cr-cmd/src/index.ts`; update README when flags or output change.
- README files are copied into packages by `scripts/readme-sync.mjs` during build.
