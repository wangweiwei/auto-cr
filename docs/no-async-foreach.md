# no-async-foreach / 禁止在 forEach 中使用 async 回调

## 1. 目的
- `forEach` 会忽略回调的返回值，因此不会等待 `async` 回调返回的 Promise。
- 结果是两个典型 bug：调用方在回调完成前就继续执行（后续逻辑读到未完成的状态）；回调内抛出的异常不再是同步异常，而是变成未处理的 Promise rejection。

## 2. 适用范围
- JavaScript / TypeScript 源码中所有 `xxx.forEach(...)` 调用，包括数组、`Map`、`Set`、`NodeList` 等，语义一致。
- 仅覆盖内联的函数回调（箭头函数与 `function` 表达式），包括嵌套在其它回调内部的 `forEach`。

## 3. 规则说明
- 约束：传给 `forEach` 的回调不得声明为 `async`。
- 判定方式：复用共享分析索引 `analysis.callbacks`（数组高阶方法的内联回调列表），筛选 `method === 'forEach'` 且回调带 `async` 标记的条目。
- 回调体内是否出现 `await` 不影响判定：只要回调是 `async`，其返回的 Promise 就一定被 `forEach` 丢弃，抛错语义也已经改变。
- 严重程度：warning（默认 tag：`base`）。
- 可配置项：当前版本无可配置参数；可通过配置文件关闭或调整严重级别。

## 4. 示例
### 4.1 违规示例
```ts
ids.forEach(async (id) => {
  await save(id) // forEach 不会等待，调用方会立刻继续
})
console.log('done') // 实际打印时 save 可能尚未完成
```
### 4.2 合规示例
```ts
// 需要顺序执行
for (const id of ids) {
  await save(id)
}

// 可以并发执行
await Promise.all(ids.map(async (id) => save(id)))
```

## 5. 例外/豁免
- 有意“发射后不管”（fire-and-forget）的场景仍会被上报。此时建议显式写成 `for...of` 里的 `void save(id)`，或在配置中关闭本规则，以明确表达意图。
- 回调以标识符形式传入（如 `ids.forEach(handler)`，其中 `handler` 为 `async` 函数）当前不在检测范围内。

## 6. 与工具的映射
- 规则 ID：`no-async-foreach`
- 规则实现：`packages/auto-cr-rules/src/rules/noAsyncForEach.ts`
- 启用方式：`auto-cr-cmd` 默认加载内置规则集并启用本规则；可在 `.autocrrc.json` 的 `rules` 中设为 `"off"` 或调整严重级别。

## 7. 版本与变更
- 当前规则版本参考包版本：`auto-cr-rules@2.0.121`
- 变更记录：
  - 2.0.121：新增规则，检测传给 `forEach` 的 `async` 回调。

## 8. 参考资料
- MDN：Array.prototype.forEach（"forEach expects a synchronous function"）：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/forEach
- MDN：for...of：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for...of
