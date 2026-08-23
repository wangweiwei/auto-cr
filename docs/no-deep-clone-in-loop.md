# no-deep-clone-in-loop / 禁止在热路径中深拷贝

## 1. 目的
- `structuredClone(obj)` 与 `JSON.parse(JSON.stringify(obj))` 都会递归遍历并重建整个对象图。放在循环或数组回调里，开销随"迭代次数 × 对象大小"增长，是 profile 里最常见的热点之一。
- 多数场景并不需要整份副本：往往只读其中几个字段，或者浅拷贝就够。

## 2. 适用范围
- 热路径（循环体与数组高阶方法回调）内的以下调用：
  - `structuredClone(...)` / `globalThis.structuredClone(...)`
  - `JSON.parse(JSON.stringify(...))`（以嵌套调用形式出现）

## 3. 规则说明
- 约束：热路径中不得调用上述标准深拷贝。
- 判定方式：复用共享分析索引 `analysis.hotPath.callExpressions`（仅含热路径内的调用点），按 callee 形态匹配上述两种写法；`JSON.parse(JSON.stringify(x))` 只在外层 `JSON.parse` 上报一次。
- 只覆盖 JS 标准函数：`lodash.cloneDeep`、`klona`、`rfdc` 等第三方深拷贝不在范围内。
- 严重程度：optimizing（默认 tag：`performance`）。
- 可配置项：当前版本无可配置参数；可通过配置文件关闭或调整严重级别。

## 4. 示例
### 4.1 违规示例
```ts
for (const payload of payloads) {
  const clone = structuredClone(payload)           // 每轮完整深拷贝
}
items.map((item) => JSON.parse(JSON.stringify(item)))
```
### 4.2 合规示例
```ts
for (const payload of payloads) {
  const { id, meta } = payload                     // 只取需要的字段
  const shallow = { ...payload }                   // 或浅拷贝
}
const snapshot = structuredClone(state)            // 循环外一次性拷贝
```

## 5. 例外/豁免
- 确需每轮隔离可变数据时，考虑在循环外拷贝一次再按需局部复制，或改用不可变数据结构。
- 单独出现的 `JSON.stringify(...)`（序列化而非拷贝）不会被报出。

## 6. 与工具的映射
- 规则 ID：`no-deep-clone-in-loop`
- 规则实现：`packages/auto-cr-rules/src/rules/noDeepCloneInLoop.ts`
- 启用方式：`auto-cr-cmd` 默认加载内置规则集并启用本规则；可在 `.autocrrc.json` 的 `rules` 中设为 `"off"` 或调整严重级别。

## 7. 版本与变更
- 当前规则版本参考包版本：`auto-cr-rules@2.0.121`
- 变更记录：
  - 2.0.121：补充规则文档，行为不变。

## 8. 参考资料
- MDN：structuredClone()：https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone
