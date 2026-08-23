# no-circular-dependencies / 禁止循环依赖

## 1. 目的
- 模块之间互相引用会让初始化顺序取决于"谁先被加载"：ESM 下会在初始化前读到 `undefined`（TDZ），CJS 下会拿到只填了一半的 `exports`，错误往往只在某个特定入口下才出现。
- 循环也是模块边界失控的信号：两个模块互相需要对方，通常意味着有一块共享逻辑该独立出去。

## 2. 适用范围
- JavaScript / TypeScript 源码中所有带字符串字面量说明符的模块引用：静态 `import`、动态 `import()`、`require()`、`export ... from` 再导出。
- 可解析的目标：相对路径；tsconfig 的 `paths` / `baseUrl` / `rootDirs`（含 `extends` 链）；工作区包（`pnpm-workspace.yaml`，缺省按 `packages/*`、`apps/*` 扫描）的 `exports` / `main` / `module` / `types` 入口。
- 文件扩展名：`.ts` `.tsx` `.js` `.jsx` `.mjs` `.cjs`；解析到 `.d.ts` 的目标忽略；`node_modules` 中的第三方包不进入依赖图。

## 3. 规则说明
- 约束：从当前文件出发，沿依赖图不得回到自身。
- 判定方式：
  - 对当前文件的每条引用做模块解析；解析成功后，从目标文件出发做深度优先搜索，寻找一条回到当前文件的路径。
  - 搜索上限：最多访问 2000 个节点、最深 80 层（`MAX_GRAPH_NODES` / `MAX_GRAPH_DEPTH`），超限即放弃该方向的搜索，避免超大仓库卡顿。
  - 依赖图的边只有一个来源：对文件文本做 import / require / export-from / import() 提取（已去除注释）。所有 worker 线程看到的图因此完全一致。
  - 上报粒度：**每个参与环的文件各报一次**，同一文件内同一个环（按路径规范化、旋转到最小形式去重）只报一次。`a → b → c → a` 会在 a、b、c 三个文件各得到一条报告，链路以相对项目根的路径展示。
  - 第二类发现：引用走了别名 / `baseUrl` / 工作区包却解析失败时，会以 `unresolvedImport` 文案单独上报，提示检查 tsconfig 或 `package.json` 的 `exports`。相对路径解析失败不上报。
  - 项目根：文件在 cwd 之内时取 cwd；否则从文件自身向上寻找 `pnpm-workspace.yaml`、再退到最近的 `package.json`，都找不到时取文件所在的文件系统根。扫描 cwd 之外的路径同样有效。
- 严重程度：warning（默认 tag：`base`）。
- 可配置项：当前版本无可配置参数；可通过配置文件关闭或调整严重级别。

## 4. 示例
### 4.1 违规示例
```ts
// a.ts
import { getB } from './b'
// b.ts
import { getC } from './c'
// c.ts
import { getA } from './a'     // 回到 a：a → b → c → a，三个文件各报一次
```
### 4.2 合规示例
```ts
// shared.ts —— 把双方都需要的部分下沉
export const format = (value: string): string => value.trim()
// a.ts / b.ts 各自只依赖 shared.ts，互不引用
import { format } from './shared'
```

## 5. 例外/豁免
- 仅类型的引用（`import type { X } from './y'`）同样计入边：它在运行时无害，但仍会被报出。需要时可改用类型聚合模块打破环。
- 说明符不是字面量的 `import(expr)` / `require(expr)` 不进入依赖图（见 `no-non-literal-dynamic-import`）。
- 超出节点/深度上限的超大依赖图可能漏报（放弃搜索而非报错）；这是为响应速度做的取舍。
- 结果缓存按进程保留（模块解析、tsconfig、工作区索引），同一进程内多次扫描期间修改文件不会被感知。

## 6. 与工具的映射
- 规则 ID：`no-circular-dependencies`
- 规则实现：`packages/auto-cr-rules/src/rules/noCircularDependencies.ts`
- 启用方式：`auto-cr-cmd` 默认加载内置规则集并启用本规则；可在 `.autocrrc.json` 的 `rules` 中设为 `"off"` 或调整严重级别。

## 7. 版本与变更
- 当前规则版本参考包版本：`auto-cr-rules@2.0.121`
- 变更记录：
  - 2.0.121：补充规则文档。同版本修正：环路改为每个参与文件各报一次并在多线程下保持确定；依赖图边改为单一来源，补上 `export ... from` 形成的环；扫描 cwd 之外的路径不再静默失效。

## 8. 参考资料
- Node.js：Cycles（CommonJS）：https://nodejs.org/api/modules.html#cycles
- MDN：JavaScript modules — Cyclic imports：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules#cyclic_imports
