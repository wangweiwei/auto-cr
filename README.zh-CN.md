<p align="center">
  <a href="https://github.com/wangweiwei/auto-cr">
    <img src="https://raw.githubusercontent.com/wangweiwei/auto-cr/refs/heads/feat/v2.0/assets/images/image.png" alt="auto-cr logo" width="60" />
  </a>
</p>

<h1 align="center">自动化代码审查 CLI ⚡️</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/auto-cr-cmd"><img alt="NPM Version" src="https://img.shields.io/npm/v/auto-cr-cmd.svg?style=flat"/></a>
  <a href="https://www.npmjs.com/package/auto-cr-cmd"><img alt="NPM Downloads" src="https://img.shields.io/npm/dm/auto-cr-cmd.svg?style=flat"/></a>
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/github/license/wangweiwei/auto-cr"/></a>
  <a href="https://github.com/wangweiwei/auto-cr/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/wangweiwei/auto-cr" /></a>
</p>

> 🎯 auto-cr-cmd 是一个基于 SWC 静态分析的高速自动化代码审查 CLI，专为 JavaScript / TypeScript 团队设计，可在合并前快速发现风险代码。

> 🔧 auto-cr-rules 提供可扩展的静态分析规则集与 SDK，帮你零成本定制企业级代码审查策略。

📘 Prefer English? Read the [English README](./README.md).


## 特性亮点（自动化代码审查 & 静态代码分析）

- **内置规则库**：默认集成 SWC AST 静态分析规则，例如 `no-deep-relative-imports`。
- **可扩展 SDK**：`auto-cr-rules` 暴露 `defineRule`、`helpers.imports` 等工具，降低编写 TypeScript / JavaScript 自定义规则的复杂度。
- **工作区管理**：使用 pnpm workspace 同时管理 CLI 与规则包，一次构建即可验证完整流程。
- **发布友好**：内置版本递增脚本与 npm 发布命令，保持两个包的版本同步。

## 包概览（auto-cr-cmd & auto-cr-rules）

- **auto-cr-cmd**：基于 SWC 的极速命令行工具，聚焦自动化代码审查、CI 集成与静态代码扫描。
- **auto-cr-rules**：面向开发者的规则 SDK，支持多标签分类、国际化提示与团队定制规则发布。

## 快速开始

```bash
npx auto-cr-cmd --language zh [需要扫描的代码目录]
```

常用参数：

- `--language <zh|en>`：切换 CLI 输出语言（默认为自动检测）。
- `--rule-dir <directory>`：加载额外的自定义规则目录或包。
- `--help`：查看完整命令说明。

示例输出：

```text
ℹ️ 扫描目录: ./src
ℹ️ 扫描文件: ./src/main.ts
ℹ️ [基础规则]   
✔ auto-cr 代码扫描完成
```

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
pnpm run build
npx auto-cr-cmd --language zh --rule-dir ./examples/custom-rules -- ./examples/src
```

## 项目结构

```text
packages/
  auto-cr-rules/   # 规则 SDK 与内置规则（createRuleContext、defineRule 等）
  auto-cr-cmd/     # CLI 入口、Reporter、I18n、命令行逻辑
scripts/
  bump-version.mjs # 统一递增两个包的版本号
examples/
  custom-rules     # 自定义规则
  src              # 触发基础规则的例子
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
- 讨论社区：[Community Discussions](https://github.com/wangweiwei/auto-cr/wiki)

---

Auto CR © [2025] [dengfengwang]。许可协议： [MIT License](./LICENSE)
