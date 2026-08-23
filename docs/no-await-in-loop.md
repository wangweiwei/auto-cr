# no-await-in-loop / 避免在循环体内逐次 await

## 1. 目的
- `for (const id of ids) { await save(id) }` 会让每一轮都等上一轮完成。十个各需 100ms 的请求，串行要 1s，并发只要 100ms。
- 当各轮之间互不依赖时，这是最常见、收益最直接的一类性能改进。

## 2. 适用范围
- JavaScript / TypeScript 源码中的 `for` / `for...of` / `for...in` 循环体。
- 刻意**不**覆盖以下场景，因为它们通常是有意顺序执行：
  - `while` / `do...while`：由条件驱动的轮询、重试循环；
  - `for await (...)`：异步迭代本身就是顺序消费；
  - 循环体内含 `break` / `return`：提前退出的语义无法用 `Promise.all` 复现；
  - 把 `await` 结果赋给既有变量（`state = await step(state)`）：轮次之间携带状态，本就无法并发。

## 3. 规则说明
- 约束：集合式循环的循环体内不应直接 `await`。
- 判定方式：
  - 复用共享分析索引 `analysis.loops`，逐个检查 `for` / `for...of`（非 `for await`）/ `for...in`。
  - 只扫描循环自己这一层：遇到嵌套函数或嵌套循环即停止。嵌套函数内的 `await`（例如 `tasks.push(async () => { await x })`）正是并发写法，不能误伤；内层循环会被单独判定，内层的 `break` 也不影响外层结论。
  - 循环体内存在 `break` / `return` 时视为有意顺序执行，整个循环不报。
  - 循环体内存在 `x = await ...`（对既有标识符的重新赋值）时同样视为有意顺序执行；循环内的 `const` / `let` 声明不算。
  - 一个循环只报一次，定位到第一处 `await`。
- 严重程度：optimizing（默认 tag：`performance`）。本规则是优化建议而非缺陷断言——各轮是否真的独立只有作者知道。
- 可配置项：当前版本无可配置参数；可通过配置文件关闭或调整严重级别。

## 4. 示例
### 4.1 违规示例
```ts
for (const id of ids) {
  await save(id)                        // 每轮都等上一轮
}

for (let i = 0; i < ids.length; i += 1) {
  results.push(await load(ids[i]))
}
```
### 4.2 合规示例
```ts
await Promise.all(ids.map(async (id) => save(id)))   // 并发

for await (const chunk of stream()) {                // 异步迭代，顺序消费
  await handle(chunk)
}

while (!done()) {                                    // 轮询，条件驱动
  await sleep(50)
}

for (const id of ids) {
  try {
    return await load(id)                            // 首个成功即返回，后续不应启动
  } catch {
    continue
  }
}
```

## 5. 例外/豁免
- 各轮存在数据依赖但没有写成 `x = await ...` 形式的循环（例如只在 `await` 的参数里引用上一轮结果）无法静态识别，会被上报；此类代码可在配置中关闭本规则。
- 需要限流的场景不应简单改成 `Promise.all`——可分批执行或使用并发池（如 `p-limit`）。
- 与 `no-async-foreach` 的分工：本规则处理"串行了本可并发的循环"，后者处理"forEach 根本不会等待 async 回调"这个正确性问题。

## 6. 与工具的映射
- 规则 ID：`no-await-in-loop`
- 规则实现：`packages/auto-cr-rules/src/rules/noAwaitInLoop.ts`
- 启用方式：`auto-cr-cmd` 默认加载内置规则集并启用本规则；可在 `.autocrrc.json` 的 `rules` 中设为 `"off"` 或调整严重级别。

## 7. 版本与变更
- 当前规则版本参考包版本：`auto-cr-rules@2.0.121`
- 变更记录：
  - 2.0.121：新增规则，检测集合式循环体内的逐次 await，并排除轮询、异步迭代、提前退出与嵌套函数场景。

## 8. 参考资料
- MDN：Promise.all()：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all
- MDN：for await...of：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of
- ESLint `no-await-in-loop`（本规则在其基础上收窄了适用范围）：https://eslint.org/docs/latest/rules/no-await-in-loop
