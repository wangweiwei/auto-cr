# no-self-package-import / 禁止通过包名导入自身

## 1. 目的
- 包内模块写 `import { x } from '@scope/pkg'` 时，解析到的不是旁边的源码，而是 `node_modules/@scope/pkg`——也就是安装或构建出来的那份产物。
- 后果有三类：开发时改了源码却跑着陈旧的 dist；同一个模块被加载两份（源码一份、产物一份），单例与模块级状态各自为政；源码 → 产物 → 源码形成依赖图上看不见的循环。

## 2. 适用范围
- JavaScript / TypeScript 源码中的所有模块引用：静态 `import`、动态 `import()`、`require()`、`export ... from` 再导出。
- monorepo 中按工作区包判定所属；单包仓库退回到最近的 `package.json`。

## 3. 规则说明
- 约束：模块不得通过自己所在包的包名（根入口或任意子路径）引用同包内容。
- 判定方式：
  - 复用 `no-cross-package-private-imports` 使用的工作区包索引（`pnpm-workspace.yaml`，缺省时按 `packages/*`、`apps/*` 扫描），用 `findOwningWorkspacePackage` 取文件所属的包。
  - 工作区索引为空（单包仓库）时，向上寻找最近的 `package.json` 并读取 `name`。工作区存在但文件不属于任何包（例如根目录脚本）时不做判定。
  - 对每条引用解析出包名（`@scope/name` 或 `name`，`node:` 前缀会被去掉），与所属包名相等即违规。
- 测试文件豁免：包内的 `*.test.*` / `*.spec.*` 或 `__tests__/` 等目录下的文件以消费者视角引用公开入口是常见且合理的写法，不上报。判定相对于包目录进行，包自身的目录名不参与。
- 严重程度：warning（默认 tag：`architecture`）。
- 可配置项：当前版本无可配置参数；可通过配置文件关闭或调整严重级别。

## 4. 示例
### 4.1 违规示例
```ts
// packages/core/src/service.ts
import { add } from '@demo/core'                 // 根入口自引用
import { add as viaSub } from '@demo/core/utils' // 子路径自引用
export { add as reexported } from '@demo/core'   // 再导出
const lazy = () => import('@demo/core')          // 动态导入
```
### 4.2 合规示例
```ts
// packages/core/src/service.ts
import { add } from './utils'                    // 同包内用相对路径

// packages/core/src/index.test.ts
import { add } from '@demo/core'                 // 测试以消费者视角引用公开入口，豁免

// packages/app/src/index.ts
import { add } from '@demo/core'                 // 跨包引用公开入口，属于另一条规则的范围
```

## 5. 例外/豁免
- Node 的 package self-referencing（包声明了 `exports` 后允许用自己的名字引用自身）是合法语法，但它正是上述"双实例/陈旧代码"问题在 monorepo 中的来源，因此本规则仍然上报；确有需要时可在配置中关闭。
- 通过 tsconfig `paths` 把包名映射到 `src` 的项目，运行时仍按包名解析，问题依旧存在；建议把别名改成不与包名重合的形式（如 `@core/*`）。

## 6. 与工具的映射
- 规则 ID：`no-self-package-import`
- 规则实现：`packages/auto-cr-rules/src/rules/noSelfPackageImport.ts`
- 启用方式：`auto-cr-cmd` 默认加载内置规则集并启用本规则；可在 `.autocrrc.json` 的 `rules` 中设为 `"off"` 或调整严重级别。

## 7. 版本与变更
- 当前规则版本参考包版本：`auto-cr-rules@2.0.121`
- 变更记录：
  - 2.0.121：新增规则，检测模块通过包名引用自身所在的包。

## 8. 参考资料
- Node.js：Self-referencing a package using its name：https://nodejs.org/api/packages.html#self-referencing-a-package-using-its-name
- pnpm：Workspace：https://pnpm.io/workspaces
