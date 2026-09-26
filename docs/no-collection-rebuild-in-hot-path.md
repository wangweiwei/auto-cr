# no-collection-rebuild-in-hot-path / 禁止在热路径中反复构建不变的集合

## 1. 目的
- `users.filter((u) => admins.map((a) => a.id).includes(u.id))` 这类写法里，`admins` 在迭代之间并不变化，但 `admins.map(...)` 会在每一轮重新分配、重新遍历一次：n 次迭代就是 n 份完全相同的工作。
- 用来做成员判断时，还叠加了线性查找，整体从 O(n + m) 退化为 O(n·m)。把集合提升到循环外构建一次（顺便改成 `Set` / `Map`），通常能把耗时降低一到两个数量级：在 Node 22 上，2 万个用户 × 2000 个管理员的上例约 270ms，提升为 `Set` 后约 1.4ms。
- ESLint 生态（含 typescript-eslint、unicorn、sonarjs）没有“循环不变量”层面的检测，本规则补上这一块。

## 2. 适用范围
- JavaScript / TypeScript 源码中的热路径：循环体与循环条件（`for` / `for...of` / `for...in` / `while` / `do...while`）、数组高阶方法回调（`map` / `forEach` / `filter` / `reduce` 等）。
- 覆盖的“构建”形态：
  - `new Set(x)` / `new Map(x)`；
  - `x.map(...)` / `filter` / `flatMap` / `flat` / `split` / `concat` / `slice` / `toSorted` / `toReversed`，以及接收者本身是新集合时的 `sort` / `reverse`；
  - `Object.keys` / `values` / `entries` / `fromEntries(x)`、`Array.from(x)`、`[...x]`（含 `[...byId.keys()]` 这类对无参 `keys()` / `values()` / `entries()` 的展开）。

## 3. 规则说明
- 约束：热路径中不得反复构建一个在迭代之间不变、且只被只读使用的集合。
- 判定方式（三个条件同时满足才上报）：
  - **只读消费**：构建结果立刻被查找/取长度/按下标读取（`.has` / `.includes` / `.indexOf` / `.findIndex` / `.some` / `.every` / `.join` / `.get` / `.find` / `.at` / `.length` / `.size` / `[i]`）；或赋给本轮的 `const`，且该常量在本作用域内只以上述方式被读取。被修改、被传参、被返回、被 `for...of` 遍历的结果都不报——那可能是有意为每轮准备的新副本，遍历本身也是 O(m)，重建只多一个常数因子。
    - 集合元素本身是每轮新建的对象时（`new Map(STATUSES.map((s) => [s, []]))`），`.get` / `.find` / `.at` 取出的元素随后可能被修改，这类读取不算只读。
  - **迭代间不变**：表达式只由标识符、成员访问、字面量与上述构建调用组成；回调中没有 `await`、随机数或对外部变量的写入；引用到的名字不是循环变量/回调参数，没有在作用域内声明、赋值或被原地修改（调用了非只读方法、作为参数传给未知函数也算修改），也没有在文件其它地方被重新赋值；作用域内也没有 `await` / `yield`（挂起期间其它代码可能修改数据）。若回调依赖元素（带参数的回调、`admins.map(getId)` 这类函数引用），作用域内还不能改写任何对象字段，也不能把取自该集合的元素传给未知函数（`normalize(admin)` 之后 `admins.map((a) => a.active)` 不再视为不变）。
  - **不在条件驱动的循环条件里**：`while` / `do...while` / 没有更新子句的 `for (; cond; )` 的条件必须随迭代变化才能终止，据此推断“不变”并不可靠。
- 位于 `throw`（外层没有 `try`）或循环中 `return` 语句里的构建不报：每次进入作用域至多执行一次，不属于热路径。
- 只报最外层的构建表达式：`new Set(admins.map(...))` 报一次 `new Set(...)`。
- 严重程度：optimizing（默认 tag：`performance`）。
- 可配置项：当前版本无可配置参数；可通过配置文件关闭或调整严重级别。

## 4. 示例
### 4.1 违规示例
```ts
const adminUsers = users.filter((user) => admins.map((admin) => admin.id).includes(user.id))
const picked = users.filter((user) => new Set(ids).has(user.id))           // 每个元素都建一个 Set
const tags = users.flatMap((u) => u.tags.filter((t) => allowedCsv.split(',').includes(t)))

for (let i = 0; i < Object.keys(schema).length; i++) { /* ... */ }           // 条件里每轮重算

for (const row of rows) {
  const keys = Object.keys(schema)                                          // 本轮 const，只被读取
  if (keys.includes(row.key)) { /* ... */ }
}
```
### 4.2 合规示例
```ts
const adminIds = new Set(admins.map((admin) => admin.id))                  // 提升到循环外，并改成 Set
const adminUsers = users.filter((user) => adminIds.has(user.id))

users.map((user) => user.tags.filter((tag) => tag.startsWith('a')).length) // 依赖当前元素，必须逐个计算

for (const row of rows) {
  const copy = base.slice()                                                 // 有意为每轮准备的副本，随后被修改
  copy.push(row.key)
}
```

## 5. 例外/豁免
- 规则按“宁可漏报、不误报”设计，但以下修改静态分析看不到，遇到由此导致的误报，可在该处关闭本规则：
  - 循环中调用的普通函数悄悄修改了集合（例如 `refresh()` 内部 `admins.push(...)`，没有把 `admins` 作为参数传入）；
  - 经由别名的修改（`const q = seen; q.push(x)` 之后读取 `seen`）。
- 只在第一轮执行的分支（如 `if (i === 0) { ... }`）里的构建也会被报出；这类情况提升与否影响不大，可按需忽略。
- 与 `no-n2-array-lookup` 互补：后者提示“热路径里做了线性查找”，本规则提示“查找的集合本身每轮都在重建”。同一处可能各报一次，对应“提升”与“改用 Set/Map”两个修复动作。

## 6. 与工具的映射
- 规则 ID：`no-collection-rebuild-in-hot-path`
- 规则实现：`packages/auto-cr-rules/src/rules/noCollectionRebuildInHotPath.ts`（作用域与不变性分析：`packages/auto-cr-rules/src/rules/utils/hotScopes.ts`）
- 启用方式：`auto-cr-cmd` 默认加载内置规则集并启用本规则；可在 `.autocrrc.json` 的 `rules` 中设为 `"off"` 或调整严重级别。

## 7. 版本与变更
- 当前规则版本参考包版本：`auto-cr-rules@2.0.124`
- 变更记录：
  - 2.0.124：新增规则，检测热路径中反复构建的不变集合；共享分析索引新增 `reassignedNames`。

## 8. 参考资料
- MDN：Set（`has` 平均快于 `Array.prototype.includes`）：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set#performance
- Wikipedia：Loop-invariant code motion：https://en.wikipedia.org/wiki/Loop-invariant_code_motion
