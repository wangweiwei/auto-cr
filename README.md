<p align="center">
  <a href="https://github.com/wangweiwei/auto-cr">
    <img src="https://github.com/wangweiwei/auto-cr/blob/main/assets/images/logo.png?raw=true" alt="auto-cr logo" width="60" />
  </a>
</p>

<h1 align="center">Automated Code Review CLI ⚡️</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/auto-cr-cmd"><img alt="NPM Version" src="https://img.shields.io/npm/v/auto-cr-cmd.svg?style=flat"/></a>
  <a href="https://www.npmjs.com/package/auto-cr-cmd"><img alt="NPM Downloads" src="https://img.shields.io/npm/dm/auto-cr-cmd.svg?style=flat"/></a>
  <a href="https://github.com/wangweiwei/auto-cr/blob/main/LICENSE"><img alt="MIT License" src="https://img.shields.io/github/license/wangweiwei/auto-cr"/></a>
  <a href="https://github.com/wangweiwei/auto-cr/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/wangweiwei/auto-cr" /></a>
</p>

> 🎯 [auto-cr-cmd](https://github.com/wangweiwei/auto-cr/tree/main/packages/auto-cr-cmd) is a high-speed automated code review CLI powered by SWC static analysis, built for JavaScript / TypeScript teams to surface risky code before it merges.
>
> 🔧 [auto-cr-rules](https://github.com/wangweiwei/auto-cr/tree/main/packages/auto-cr-rules) provides an extensible static analysis rule set and SDK so you can tailor enterprise-grade review policies with minimal effort.

📘 Prefer Chinese? Read the [Chinese README](https://github.com/wangweiwei/auto-cr/blob/main/README.zh-CN.md).


## Feature Highlights (Automated Code Review & Static Analysis)

- **Built-in Rule Library**: Ships with SWC AST static analysis rules out of the box, such as `no-deep-relative-imports`.
- **Extensible SDK**: `auto-cr-rules` exposes helpers like `defineRule` and `helpers.imports`, reducing the friction of authoring custom TypeScript / JavaScript rules.
- **Workspace Friendly**: Manage both the CLI and rule package via pnpm workspaces and validate the full pipeline with a single build.
- **Publishing Toolkit**: Version bump scripts and npm publish commands keep both packages in sync.

## Package Overview ([auto-cr-cmd](https://github.com/wangweiwei/auto-cr/tree/main/packages/auto-cr-cmd) & [auto-cr-rules](https://github.com/wangweiwei/auto-cr/tree/main/packages/auto-cr-rules))

- **[auto-cr-cmd](https://github.com/wangweiwei/auto-cr/tree/main/packages/auto-cr-cmd)**: A lightning-fast SWC-based CLI focused on automated reviews, CI integration, and static code scanning.
- **[auto-cr-rules](https://github.com/wangweiwei/auto-cr/tree/main/packages/auto-cr-rules)**: A developer-facing rule SDK with tag-based grouping, internationalized messaging, and support for publishing team-specific rules.

## Quick Start

```bash
npx auto-cr-cmd --language en [path-to-your-code]
```

Common flags:

- `--language <zh|en>`: Switch CLI output language (defaults to auto-detection).
- `--rule-dir <directory>`: Load additional custom rules from a directory or package.
- `--output <text|json>`: Choose between human-friendly text logs or structured JSON results (defaults to `text`).
- `--help`: Display the full command reference.

Sample output:

```text
 WARN  [12:56:18] ⚠️ [Base Rules]: no-deep-relative-imports

    File: /Volumes/Wei/Codes/github/auto-cr/examples/src/app/features/admin/pages/dashboard.ts:2 
    Description: Import path "../../../../shared/deep/utils" must not exceed max depth 2 
    Code: ../../../../shared/deep/utils
    Suggestion: Use a path alias (for example: @shared/deep/utils). | Create an index file at a higher level to re-export the module and shorten the import.

 WARN  [12:56:18] ⚠️ [untagged]: no-index-import

    File: /Volumes/Wei/Codes/github/auto-cr/examples/src/app/features/admin/pages/dashboard.ts:3
    Description: Import ../../consts/index is not allowed. Import the concrete file instead.

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
npx auto-cr-cmd -l zh -r ./custom-rules/rules -- ./custom-rules/demo
```

## Project Layout

```text
packages/
  auto-cr-rules/   # Rule SDK and built-in rules (createRuleContext, defineRule, etc.)
  auto-cr-cmd/     # CLI entry point, reporter, i18n, and command handling
scripts/
  bump-version.mjs # Keep both package versions aligned
examples/
  custom-rules     # Custom rule samples
  src              # Example that triggers the base rule
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
