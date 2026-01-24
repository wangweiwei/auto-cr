<p align="center">
  <a href="https://github.com/wangweiwei/auto-cr">
    <img src="https://github.com/wangweiwei/auto-cr/blob/main/assets/images/logo.png?raw=true" alt="auto-cr logo" width="100" />
  </a>
</p>

<h1 align="center">自动化代码审查 CLI ⚡️</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/auto-cr-cmd"><img alt="NPM Version" src="https://img.shields.io/npm/v/auto-cr-cmd.svg?style=flat"/></a>
  <a href="https://www.npmjs.com/package/auto-cr-cmd"><img alt="NPM Downloads" src="https://img.shields.io/npm/d18m/auto-cr-cmd.svg?style=flat"/></a>
  <a href="https://github.com/wangweiwei/auto-cr/blob/main/LICENSE"><img alt="MIT License" src="https://img.shields.io/github/license/wangweiwei/auto-cr"/></a>
  <a href="https://github.com/wangweiwei/auto-cr/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/wangweiwei/auto-cr" /></a>
</p>

> 🎯 [auto-cr-cmd](https://github.com/wangweiwei/auto-cr/tree/main/packages/auto-cr-cmd) 是一个基于 SWC 静态分析的高速自动化代码审查 CLI，专为 JavaScript / TypeScript 团队设计，可在合并前快速发现风险代码。

> 🔧 [auto-cr-rules](https://github.com/wangweiwei/auto-cr/tree/main/packages/auto-cr-rules) 提供可扩展的静态分析规则集与 SDK，帮你零成本定制企业级代码审查策略。

📘 Prefer English? Read the [English README](https://github.com/wangweiwei/auto-cr/blob/main/README.md).


## 特性亮点（自动化代码审查 & 静态代码分析）

- **内置规则库**：默认集成 SWC AST 静态分析规则，例如 `no-deep-relative-imports`、`no-circular-dependencies`、`no-swallowed-errors`、`no-catastrophic-regex`、`no-deep-clone-in-loop`、`no-n2-array-lookup`。
- **可扩展 SDK**：`auto-cr-rules` 暴露 `defineRule`、`helpers.imports` 等工具，降低编写 TypeScript / JavaScript 自定义规则的复杂度。
- **工作区管理**：使用 pnpm workspace 同时管理 CLI 与规则包，一次构建即可验证完整流程。
- **发布友好**：内置版本递增脚本与 npm 发布命令，保持两个包的版本同步。

## 包概览（[auto-cr-cmd](https://github.com/wangweiwei/auto-cr/tree/main/packages/auto-cr-cmd) & [auto-cr-rules](https://github.com/wangweiwei/auto-cr/tree/main/packages/auto-cr-rules)）

- **[auto-cr-cmd](https://github.com/wangweiwei/auto-cr/tree/main/packages/auto-cr-cmd)**：基于 SWC 的极速命令行工具，聚焦自动化代码审查、CI 集成与静态代码扫描。
- **[auto-cr-rules](https://github.com/wangweiwei/auto-cr/tree/main/packages/auto-cr-rules)**：面向开发者的规则 SDK，支持多标签分类、国际化提示与团队定制规则发布。

## 安装

```bash
pnpm add -D auto-cr-cmd
# or
npm i -D auto-cr-cmd
```

## 快速开始

```bash
npx auto-cr-cmd --language zh [需要扫描的代码目录]
```

常用参数：

- `--language <zh|en>`：切换 CLI 输出语言（默认读取 `LANG`，缺省回退为 `zh`）。
- `--rule-dir <directory>`：加载额外的自定义规则目录或包。
- `--output <text|json>`：选择输出格式，`text` 为友好的终端日志，`json` 用于集成脚本（默认为 `text`）。
- `--progress [tty-only|yes|no]`：进度显示模式（仅 text 输出，默认 `no`），输出到 stderr。
- `--stdin`：从标准输入读取扫描路径（管道输入时自动读取；支持换行或 NUL 分隔）。
- `--config <path>`：指定 `.autocrrc.json` 或 `.autocrrc.js` 配置文件路径，用于开启/关闭规则。
- `--ignore-path <path>`：指定 `.autocrignore.json` 或 `.autocrignore.js` 忽略文件路径，用于排除扫描。
- `--tsconfig <path>`：指定自定义 `tsconfig.json` 路径（默认读取 `<cwd>/tsconfig.json`）。
- `--help`：查看完整命令说明。

说明：

- 仅扫描 `.ts` / `.tsx` / `.js` / `.jsx`；`.d.ts` 会被跳过。
- 目录扫描默认跳过 `node_modules`。
- text 输出写入 `stderr`；JSON 输出写入 `stdout`，便于脚本解析。

从 STDIN 读取路径：

```bash
git diff --name-only -z | npx auto-cr-cmd --stdin --output json
```

示例输出：

```text
[auto-cr] [warning] /path/to/project/examples/noDeepRelativeImports/app/features/admin/pages/dashboard.ts:2 导入路径 "../../../../shared/deep/utils"，不能超过最大层级2
  rule: no-deep-relative-imports (基础规则)
  code: ../../../../shared/deep/utils
  suggestion:
    - 使用别名路径（如 @shared/deep/utils）。
    - 或在上层聚合导出，避免过深相对路径。
[auto-cr] [warning] /path/to/project/examples/noDeepRelativeImports/app/features/admin/pages/dashboard.ts:3 禁止直接导入 ../../consts/index，请改用具体文件
  rule: no-index-import (未定义)

✔  代码扫描完成，本次共扫描3个文件，其中0个文件存在错误，1个文件存在警告，0个文件存在优化建议！
```

JSON 输出示例：

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
          "message": "避免从 src/components/button 进行深层相对导入",
          "line": 13
        }
      ]
    }
  ],
  "notifications": []
}
```

## 退出码

- `0`：无 error 级别违规，或没有匹配到文件。
- `1`：发现 error 级别违规，或扫描出现致命错误。

## 配置（.autocrrc）

- 在仓库根目录放置 `.autocrrc.json` 或 `.autocrrc.js`（按此顺序查找）；如需放在其他位置，可通过 `--config <path>` 指定。
- `rules` 支持的值：`off | warning | error | optimizing | true/false | 0/1/2`，未写明的规则沿用默认严重级别。

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

### 忽略文件（.autocrignore）

- 在仓库根目录放置 `.autocrignore.json` 或 `.autocrignore.js`（按此顺序查找），或通过 `--ignore-path <file>` 指定自定义路径。
- 仅支持 JSON/JS 写法，基于 picomatch 的 glob 模式，数组键为 `ignore`。

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

```js
// .autocrrc.js
module.exports = {
  rules: {
    'no-swallowed-errors': 'warning', // 覆盖严重级别
    'no-deep-relative-imports': true  // 保持规则默认严重级别
  }
}
```

## 文档索引

- [配置与忽略](./docs/config.md)
- [规则：no-deep-relative-imports](./docs/no-deep-relative-imports.md)
- [规则：no-swallowed-errors](./docs/no-swallowed-errors.md)

## 编写自定义规则

CLI 默认使用 `auto-cr-rules` 包提供的规则，你也可以扩展自己的逻辑。

### 1. 准备目录

```bash
mkdir custom-rules
```

目录内放置可被 Node.js 执行的 `.js` / `.cjs` / `.mjs` 文件。

### 2. 安装 SDK

```bash
pnpm add auto-cr-rules
```

### 3. 编写规则

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

`RuleContext` 提供：

- `helpers.imports`：统一收集的 `import` / `require` / 动态导入引用。
- `helpers.isRelativePath`、`helpers.relativeDepth`：常见路径判断工具。
- `helpers.reportViolation(message, span?)`：统一的问题上报接口。
- `language` 与 `reporter`：可获取当前语言和底层 Reporter API。

也可以一次导出多个规则：

```js
const { defineRule } = require('auto-cr-rules')

const ruleA = defineRule('rule-a', (context) => { /* ... */ })
const ruleB = defineRule('rule-b', (context) => { /* ... */ })

module.exports = { rules: [ruleA, ruleB] }
```

### 4. 运行

```bash
cd examples
npx auto-cr-cmd -l zh -r ./custom-rules/rules -- ./custom-rules/demo
```

## 项目结构

```text
packages/
  auto-cr-rules/   # 规则 SDK 与内置规则（createRuleContext、defineRule 等）
  auto-cr-cmd/     # CLI 入口、Reporter、I18n、命令行逻辑
scripts/
  bump-version.mjs # 统一递增两个包的版本号
examples/
  custom-rules           # 自定义规则
  noDeepRelativeImports  # 深层相对导入示例
  noCircularDependencies # 循环依赖示例
  noSwallowedErrors      # 吞掉错误示例
  noCatastrophicRegex    # 灾难性回溯示例
  noDeepCloneInLoop      # 循环深拷贝示例
  noN2ArrayLookup        # O(n^2) 查询示例
```

核心脚本：

- `pnpm run version [major|minor|patch]`：统一更新两个包的版本号（默认 patch）。
- `pnpm run publish`：依次执行版本递增、构建与两个包的 npm 发布。

## 参与贡献

欢迎通过 Issue 或 Pull Request 贡献代码。请先阅读：

- [行为准则](./CODE_OF_CONDUCT.md)
- [贡献指南](./CONTRIBUTING.md)

## 社区与支持

- 问题反馈：[Issue Tracker](https://github.com/wangweiwei/auto-cr/issues)
- 讨论社区：[Community Discussions](https://github.com/wangweiwei/auto-cr/discussions)

---

Auto CR © [2025] [dengfengwang]。许可协议： [MIT License](https://github.com/wangweiwei/auto-cr/blob/main/LICENSE)

AI/agents 说明见 [AGENTS.md](./AGENTS.md)、[SKILL.md](./SKILL.md)（中文见 [AGENTS.zh-CN.md](./AGENTS.zh-CN.md)、[SKILL.zh-CN.md](./SKILL.zh-CN.md)）。
