# SKILL：auto-cr-cli

用于运行 auto-cr 或说明其配置方式的技能说明。

## 输入

- 扫描路径（文件或目录）。
- 可选配置：`.autocrrc.json` / `.autocrrc.js`。
- 可选忽略：`.autocrignore.json` / `.autocrignore.js`。
- 可选自定义规则目录：`--rule-dir`。
- 可选输出格式：`--output text|json`。
- 可选语言：`--language zh|en`。
- 可选 tsconfig：`--tsconfig <path>`。
- 可选 stdin 模式：`--stdin` 从标准输入读取路径。

## 使用步骤

1. 基本扫描：`npx auto-cr-cmd --language en <path>`
2. JSON 输出：`npx auto-cr-cmd --output json <path>`
3. 自定义规则：`npx auto-cr-cmd --rule-dir <dir> <path>`
4. 指定配置与忽略文件：
   `npx auto-cr-cmd --config .autocrrc.json --ignore-path .autocrignore.json <path>`
5. 从 STDIN 读取路径（换行或 NUL 分隔）：
   `git diff --name-only -z | npx auto-cr-cmd --stdin --output json`

## JSON 输出速览

- `summary.scannedFiles`, `summary.filesWithErrors`, `summary.filesWithWarnings`, `summary.filesWithOptimizing`
- `summary.violationTotals`（按严重级别统计）
- `files[].filePath`, `files[].severityCounts`, `files[].totalViolations`, `files[].errorViolations`
- `files[].violations[]` 包含 `tag`, `ruleName`, `severity`, `message`, 可选 `line`, 可选 `code`, 以及 `suggestions`
- `notifications[]`

当存在 error 级别违规时，退出码为 `1`，否则为 `0`。

## 备注

- 扫描 `.ts` / `.tsx` / `.js` / `.jsx`；`.d.ts` 会被跳过。
- 目录扫描默认跳过 `node_modules`。
- text 输出写入 `stderr`；JSON 输出写入 `stdout`。
- 管道输入时自动读取 STDIN（可用 `--stdin` 强制）。
- 使用 `AUTO_CR_WORKERS=0|1|N` 控制并发。

## 参考

- `README.md`
- `docs/config.md`
- `examples/`
