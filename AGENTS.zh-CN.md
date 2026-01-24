# AGENTS（面向 AI）

此文件供 AI 代理与自动化工具使用。面向人类阅读与 SEO 的内容请以 README.md 为准。

## AI 元数据

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

## CLI 行为（结构化）

```yaml
cli_options:
  - flag: --language
    values: [zh, en]
    default: LANG 环境变量（缺省回退 zh）
  - flag: --output
    values: [text, json]
    default: text
  - flag: --progress
    values: [tty-only, yes, no]
    default: no
  - flag: --stdin
    note: "管道输入时自动读取；支持换行或 NUL 分隔"
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
  AUTO_CR_WORKERS: "0/1 为单线程；>1 指定 worker 数；默认文件数>=20时使用 CPU-1"
```

## 仓库结构

- `packages/auto-cr-cmd`：CLI 实现（入口：`packages/auto-cr-cmd/src/index.ts`）。
- `packages/auto-cr-rules`：规则 SDK + 内置规则（规则在 `packages/auto-cr-rules/src/rules`，文案在 `packages/auto-cr-rules/src/messages.ts`）。
- `docs/`：配置与规则说明。
- `examples/`：示例项目与规则演示。
- `scripts/`：工作区脚本工具（含 README 同步脚本）。

## 常用命令

- 安装依赖：`pnpm install`（工作区使用 `pnpm@10.15.1`）。
- 构建全部：`pnpm run build`
- 强制构建：`pnpm run build:force`
- CLI 开发监听：`pnpm run dev`
- 运行 TS 版 CLI：`pnpm run cli`

## 用户侧配置

- `.autocrrc.json` / `.autocrrc.js` 用于规则设置（见 `docs/config.md`）。
- `.autocrignore.json` / `.autocrignore.js` 用于忽略路径（见 `docs/config.md`）。
- 默认读取 `tsconfig.json` 以推导解析参数，可用 `--tsconfig` 覆盖。

## 修改提示

- 新增内置规则：在 `packages/auto-cr-rules/src/rules` 中新增规则文件，并在 `packages/auto-cr-rules/src/rules/index.ts` 导出，同时在 `packages/auto-cr-rules/src/messages.ts` 添加文案，并在 `docs/` 下补规则文档。
- CLI 参数位于 `packages/auto-cr-cmd/src/index.ts`；参数或输出变动时请同步 README。
- 根目录 README 会在构建阶段通过 `scripts/readme-sync.mjs` 复制到各 package。
