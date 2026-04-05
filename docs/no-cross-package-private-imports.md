# no-cross-package-private-imports / 禁止跨包导入私有实现

## 1. 目的
- 避免 workspace 内的一个包直接依赖另一个包的 `src/`、`dist/`、`internal/` 等私有实现细节。
- 强制消费方通过包的公开入口（包根入口或 `package.json exports` 暴露的子路径）访问依赖，降低重构耦合与发布风险。

## 2. 适用范围
- JavaScript / TypeScript 源码中的静态 `import`、动态 `import()` 与 `require(...)`。
- 仅对 workspace 内跨包访问生效；同包内部导入不会触发。
- 重点覆盖两类场景：
  - 通过包名深挖到未公开的子路径，例如 `@scope/pkg/src/internal`。
  - 通过相对路径直接跨进另一个包目录，例如 `../../shared/src/internal`。

## 3. 规则说明
- 约束：
  - 若目标 workspace 包声明了 `package.json exports`，则只允许导入包根入口或已显式导出的子路径。
  - 若目标包未声明 `exports`，规则会拦截明显的私有目录深挖，例如 `src`、`dist`、`lib`、`internal`、`tests` 等。
  - 通过相对路径直接跨进另一个 workspace 包目录，一律视为违规。
- 判定方式：
  - 先根据最近的 `pnpm-workspace.yaml` 建立 workspace 包索引。
  - 再结合导入路径、相对路径解析与 `exports` 规则判断是否访问了另一个包的私有实现。
- 严重程度：warning（默认 tag：`architecture`）。
- 可配置项：当前版本无单独配置项；若需放宽策略，可在自定义规则目录中提供同名规则覆盖实现。

## 4. 示例
### 4.1 违规示例
```ts
import { secret } from '@demo/shared/src/internal'
import { secret as relativeSecret } from '../../shared/src/internal'
```

### 4.2 合规示例
```ts
import { sharedValue } from '@demo/shared'
import { publicValue } from '@demo/shared/public'
```

## 5. 例外/豁免
- 若确实需要公开一个子路径，请在目标包的 `package.json exports` 中显式声明，而不是让调用方直接依赖 `src/` 或构建产物目录。
- 历史项目若尚未统一 `exports`，建议先把公开 API 收敛到少量稳定入口，再逐步开启本规则。

## 6. 与工具的映射
- 规则 ID：`no-cross-package-private-imports`
- 规则实现：`packages/auto-cr-rules/src/rules/noCrossPackagePrivateImports.ts`
- 启用方式：`auto-cr-cmd` 默认加载内置规则集并启用本规则。

## 7. 版本与变更
- 当前规则版本参考包版本：`auto-cr-rules@2.0.117`
- 变更记录：
  - 2.0.117：新增规则文档，拦截跨 workspace 包的私有路径导入。

## 8. 参考资料
- Node.js Package Entry Points：https://nodejs.org/api/packages.html#package-entry-points
- TypeScript `paths` 选项：https://www.typescriptlang.org/tsconfig#paths
