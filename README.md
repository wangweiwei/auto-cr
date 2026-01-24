<p align="center">
  <a href="https://github.com/wangweiwei/auto-cr">
    <img src="https://github.com/wangweiwei/auto-cr/blob/main/assets/images/logo.png?raw=true" alt="auto-cr logo" width="100" />
  </a>
</p>

<h1 align="center">Automated Code Review CLI ⚡️</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/auto-cr-cmd"><img alt="NPM Version" src="https://img.shields.io/npm/v/auto-cr-cmd.svg?style=flat"/></a>
  <a href="https://www.npmjs.com/package/auto-cr-cmd"><img alt="NPM Downloads" src="https://img.shields.io/npm/d18m/auto-cr-cmd.svg?style=flat"/></a>
  <a href="https://github.com/wangweiwei/auto-cr/blob/main/LICENSE"><img alt="MIT License" src="https://img.shields.io/github/license/wangweiwei/auto-cr"/></a>
  <a href="https://github.com/wangweiwei/auto-cr/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/wangweiwei/auto-cr" /></a>
</p>

> 🎯 [auto-cr-cmd](https://github.com/wangweiwei/auto-cr/tree/main/packages/auto-cr-cmd) is a high-speed automated code review CLI powered by SWC static analysis, built for JavaScript / TypeScript teams to surface risky code before it merges.
>
> 🔧 [auto-cr-rules](https://github.com/wangweiwei/auto-cr/tree/main/packages/auto-cr-rules) provides an extensible static analysis rule set and SDK so you can tailor enterprise-grade review policies with minimal effort.

📘 Prefer Chinese? Read the [Chinese README](https://github.com/wangweiwei/auto-cr/blob/main/README.zh-CN.md).


## Feature Highlights (Automated Code Review & Static Analysis)

- **Built-in Rule Library**: Ships with SWC AST static analysis rules out of the box, such as `no-deep-relative-imports`, `no-circular-dependencies`, `no-swallowed-errors`, `no-catastrophic-regex`, `no-deep-clone-in-loop`, and `no-n2-array-lookup`.
- **Extensible SDK**: `auto-cr-rules` exposes helpers like `defineRule` and `helpers.imports`, reducing the friction of authoring custom TypeScript / JavaScript rules.
- **Workspace Friendly**: Manage both the CLI and rule package via pnpm workspaces and validate the full pipeline with a single build.
- **Publishing Toolkit**: Version bump scripts and npm publish commands keep both packages in sync.

## Package Overview ([auto-cr-cmd](https://github.com/wangweiwei/auto-cr/tree/main/packages/auto-cr-cmd) & [auto-cr-rules](https://github.com/wangweiwei/auto-cr/tree/main/packages/auto-cr-rules))

- **[auto-cr-cmd](https://github.com/wangweiwei/auto-cr/tree/main/packages/auto-cr-cmd)**: A lightning-fast SWC-based CLI focused on automated reviews, CI integration, and static code scanning.
- **[auto-cr-rules](https://github.com/wangweiwei/auto-cr/tree/main/packages/auto-cr-rules)**: A developer-facing rule SDK with tag-based grouping, internationalized messaging, and support for publishing team-specific rules.

## Install

```bash
pnpm add -D auto-cr-cmd
# or
npm i -D auto-cr-cmd
```

## Quick Start

```bash
npx auto-cr-cmd --language en [path-to-your-code]
```

Common flags:

- `--language <zh|en>`: Switch CLI output language (defaults to `LANG`, falls back to `zh`).
- `--rule-dir <directory>`: Load additional custom rules from a directory or package.
- `--output <text|json>`: Choose between human-friendly text logs or structured JSON results (defaults to `text`).
- `--progress [tty-only|yes|no]`: Progress mode (text output only, default `no`); output goes to `stderr`.
- `--stdin`: Read scan targets from STDIN (auto-detected when piped; supports newline or NUL).
- `--config <path>`: Point to a `.autocrrc.json` or `.autocrrc.js` file to enable/disable rules.
- `--ignore-path <path>`: Point to a `.autocrignore.json` or `.autocrignore.js` file to exclude files/directories from scanning.
- `--tsconfig <path>`: Use a custom `tsconfig.json` (defaults to `<cwd>/tsconfig.json`).
- `--help`: Display the full command reference.

Notes:

- Scans `.ts` / `.tsx` / `.js` / `.jsx` only; `.d.ts` files are skipped.
- Directory scans skip `node_modules` by default.
- Text output is written to `stderr`; JSON output goes to `stdout` for scripting.

Read paths from STDIN:

```bash
git diff --name-only -z | npx auto-cr-cmd --stdin --output json
```

Sample output:

```text
[auto-cr] [warning] /path/to/project/examples/noDeepRelativeImports/app/features/admin/pages/dashboard.ts:2 Import path "../../../../shared/deep/utils" must not exceed max depth 2
  rule: no-deep-relative-imports (Base)
  code: ../../../../shared/deep/utils
  suggestion:
    - Use a path alias (for example: @shared/deep/utils).
    - Create an index file at a higher level to re-export the module and shorten the import.
[auto-cr] [warning] /path/to/project/examples/noDeepRelativeImports/app/features/admin/pages/dashboard.ts:3 Import ../../consts/index is not allowed. Import the concrete file instead.
  rule: no-index-import (untagged)

✔  Code scan complete, scanned 3 files: 0 with errors, 1 with warnings, 0 with optimizing hints! 
```

JSON output sample:

```bash
npx auto-cr-cmd --output json -- ./src | jq
```

```json
{
  "summary": {
    "scannedFiles": 2,
    "filesWithErrors": 1,
    "filesWithWarnings": 0,
    "filesWithOptimizing": 1,
    "violationTotals": {
      "total": 3,
      "error": 2,
      "warning": 0,
      "optimizing": 1
    }
  },
  "files": [
    {
      "filePath": "/workspace/src/example.ts",
      "severityCounts": {
        "error": 2,
        "warning": 0,
        "optimizing": 1
      },
      "totalViolations": 3,
      "errorViolations": 2,
      "violations": [
        {
          "tag": "imports",
          "ruleName": "no-deep-relative-imports",
          "severity": "error",
          "message": "Avoid deep relative imports from src/components/button",
          "line": 13
        }
      ]
    }
  ],
  "notifications": []
}
```

## Exit Codes

- `0`: No error-level violations, or no matching files.
- `1`: Error-level violations found, or a fatal scan error occurred.

## Configuration (.autocrrc)

- Place `.autocrrc.json` or `.autocrrc.js` in your repo root (search order as listed). Use `--config <path>` to point elsewhere.
- `rules` accepts `off | warning | error | optimizing | true/false | 0/1/2`; unspecified rules keep their default severity.

```jsonc
// .autocrrc.json
{
  "rules": {
    "no-deep-relative-imports": "error",
    "no-circular-dependencies": "warning",
    "no-swallowed-errors": "off"
  }
}
```

### Ignore paths (.autocrignore)

- Place `.autocrignore.json` or `.autocrignore.js` in repo root (search order as listed), or pass `--ignore-path <file>`.
- Supports glob patterns (picomatch) via JSON/JS arrays (`{ ignore: [...] }`).

```js
// .autocrignore.js
module.exports = {
  ignore: ['node_modules', 'dist/**', '**/*.test.ts', 'public/**']
}
```

```json
// .autocrignore.json
{
  "ignore": [
    "node_modules",
    "dist/**",
    "**/*.test.ts",
    "public/**"
  ]
}
```

## Docs

- [Configuration & ignore](./docs/config.md)
- [Rule: no-deep-relative-imports](./docs/no-deep-relative-imports.md)
- [Rule: no-swallowed-errors](./docs/no-swallowed-errors.md)

## Writing Custom Rules

The CLI consumes rules from the `auto-cr-rules` package by default, and you can extend it with your own logic.

### 1. Prepare a Directory

```bash
mkdir custom-rules
```

Place Node.js-compatible `.js` / `.cjs` / `.mjs` files inside the directory.

### 2. Install the SDK

```bash
pnpm add auto-cr-rules
```

### 3. Implement a Rule

```js
// custom-rules/no-index-import.js
const { defineRule } = require('auto-cr-rules')

module.exports = defineRule('no-index-import', ({ helpers, language }) => {
  for (const ref of helpers.imports) {
    if (ref.value.endsWith('/index')) {
      const message =
        language === 'zh'
          ? `禁止直接导入 ${ref.value}，请改用具体文件`
          : `Import ${ref.value} is not allowed. Import the concrete file instead.`

      helpers.reportViolation(message, ref.span)
    }
  }
})
```

`RuleContext` offers:

- `helpers.imports`: Normalized `import` / `require` / dynamic import references.
- `helpers.isRelativePath`, `helpers.relativeDepth`: Common path utilities.
- `helpers.reportViolation(message, span?)`: Unified reporting API.
- `language` and `reporter`: Access the active language and low-level reporter APIs.

You can export multiple rules at once:

```js
const { defineRule } = require('auto-cr-rules')

const ruleA = defineRule('rule-a', (context) => { /* ... */ })
const ruleB = defineRule('rule-b', (context) => { /* ... */ })

module.exports = { rules: [ruleA, ruleB] }
```

### 4. Run It

```bash
cd examples
npx auto-cr-cmd -l en -r ./custom-rules/rules -- ./custom-rules/demo
```

## Project Layout

```text
packages/
  auto-cr-rules/   # Rule SDK and built-in rules (createRuleContext, defineRule, etc.)
  auto-cr-cmd/     # CLI entry point, reporter, i18n, and command handling
scripts/
  bump-version.mjs # Keep both package versions aligned
examples/
  custom-rules           # Custom rule samples
  noDeepRelativeImports  # Example for deep relative imports
  noCircularDependencies # Example for circular deps
  noSwallowedErrors      # Example for swallowed errors
  noCatastrophicRegex    # Example for regex backtracking
  noDeepCloneInLoop      # Example for deep clone in loops
  noN2ArrayLookup        # Example for O(n^2) lookups
```

Essential scripts:

- `pnpm run version [major|minor|patch]`: Bump both packages together (defaults to patch).
- `pnpm run publish`: Run version bump, build, and publish for both packages sequentially.

## Contributing

We welcome contributions through Issues or Pull Requests. Please read:

- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Contributing Guide](./CONTRIBUTING.md)

## Community & Support

- Issues: [Issue Tracker](https://github.com/wangweiwei/auto-cr/issues)
- Discussions: [Community Discussions](https://github.com/wangweiwei/auto-cr/discussions)

---

Auto CR © [2025] [dengfengwang]. Licensed under the [MIT License](https://github.com/wangweiwei/auto-cr/blob/main/LICENSE)

AI/agents notes: see [AGENTS.md](./AGENTS.md), [SKILL.md](./SKILL.md).
