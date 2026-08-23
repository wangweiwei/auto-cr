# no-accumulating-spread / 禁止在热路径中展开累加器

## 1. 目的
- `[...acc, x]` / `{ ...acc, [k]: v }` 看似"不可变"地追加一个元素，实际上每次都会复制整个累加器。
- 放在 `reduce` 回调或循环里，就意味着第 i 次迭代复制 i 个元素，整体从 O(n) 退化为 O(n²)；数据量上万时会从毫秒级变成秒级。

## 2. 适用范围
- JavaScript / TypeScript 源码中的 `reduce` / `reduceRight` 回调，以及所有循环体（`for` / `for...of` / `for...in` / `while` / `do...while`）和数组高阶方法回调。
- 数组字面量展开与对象字面量展开均覆盖。

## 3. 规则说明
- 约束：不得在热路径中把累加器展开进新的数组/对象字面量。
- 判定方式（两种形态）：
  - 形态 A：复用 `analysis.callbacks` 索引，取 `reduce` / `reduceRight` 回调的第一个参数作为累加器名，在回调体内查找对该标识符的展开。嵌套函数若重新绑定了同名参数，其内部不再视为累加器。
  - 形态 B：在循环体与数组回调体内查找 `x = [...x, ...]` / `x = { ...x, ... }` 形式的赋值——左右两侧为同一标识符，无需任何别名推断。不进入普通嵌套函数（它们只是定义在热路径里，未必逐次执行）。
- 展开在函数调用参数中（如 `acc.push(...item.tags)`）不在检测范围内，那不是复制累加器。
- 严重程度：optimizing（默认 tag：`performance`）。
- 可配置项：当前版本无可配置参数；可通过配置文件关闭或调整严重级别。

## 4. 示例
### 4.1 违规示例
```ts
const ids = items.reduce((acc, item) => [...acc, item.id], [])          // 形态 A
const byId = items.reduce((acc, item) => ({ ...acc, [item.id]: item }), {})

let collected = []
for (const item of items) {
  collected = [...collected, item.id]                                     // 形态 B
}
```
### 4.2 合规示例
```ts
const ids = items.reduce((acc, item) => {
  acc.push(item.id) // 原地修改并返回同一个数组
  return acc
}, [])

const byId = Object.fromEntries(items.map((item) => [item.id, item]))

const collected = items.map((item) => item.id)
const merged = [...base, ...collected] // 循环结束后只展开一次
```

## 5. 例外/豁免
- 累加器极小且固定（如最多 3 个元素）时，O(n²) 在数值上无感，可按需在配置中关闭。
- 回调第一个参数为解构模式（如 `({ list }, item) => ...`）时，不存在可识别的累加器标识符，不做检测。

## 6. 与工具的映射
- 规则 ID：`no-accumulating-spread`
- 规则实现：`packages/auto-cr-rules/src/rules/noAccumulatingSpread.ts`
- 启用方式：`auto-cr-cmd` 默认加载内置规则集并启用本规则；可在 `.autocrrc.json` 的 `rules` 中设为 `"off"` 或调整严重级别。

## 7. 版本与变更
- 当前规则版本参考包版本：`auto-cr-rules@2.0.121`
- 变更记录：
  - 2.0.121：新增规则，覆盖 reduce 累加器展开与循环携带变量的自展开赋值。

## 8. 参考资料
- Biome `noAccumulatingSpread`：https://biomejs.dev/linter/rules/no-accumulating-spread/
- MDN：Spread syntax：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Spread_syntax
