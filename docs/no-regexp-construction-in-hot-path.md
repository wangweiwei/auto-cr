# no-regexp-construction-in-hot-path / 禁止在热路径中用常量模式构造正则

## 1. 目的
- `new RegExp('...')` 每次执行都会重新解析并编译模式。放在循环或数组回调里，就意味着同一个常量正则被编译 n 次。
- 模式既然是常量，提升到循环外一次构造即可，改动零风险，收益随迭代次数线性增长。

## 2. 适用范围
- JavaScript / TypeScript 源码中的热路径：循环体（`for` / `for...of` / `for...in` / `while` / `do...while`）与数组高阶方法回调（`map` / `forEach` / `reduce` / `filter` 等）。
- 覆盖 `new RegExp(...)` 与不带 `new` 的 `RegExp(...)` 两种调用。

## 3. 规则说明
- 约束：热路径中不得用常量模式构造正则。
- 判定方式：
  - 复用共享分析索引 `analysis.hotPath.newExpressions` / `callExpressions`（仅包含热路径内的节点），筛选 callee 为 `RegExp` 的调用。
  - 模式参数必须是字符串字面量或**不含插值**的模板字符串；flags 参数缺省或同样为静态字符串。任一为动态值（变量、插值模板、表达式）时不报——那种情况无法简单提升，报了只会制造噪音。
- 正则字面量 `/.../` 不在范围内：引擎按出现位置缓存其编译结果，循环内反复求值只产生对象分配而非重新编译。
- 严重程度：optimizing（默认 tag：`performance`）。
- 可配置项：当前版本无可配置参数；可通过配置文件关闭或调整严重级别。

## 4. 示例
### 4.1 违规示例
```ts
for (const line of lines) {
  if (new RegExp('^\\d+$').test(line)) { /* ... */ }   // 每次迭代重新编译
}
const errors = lines.filter((line) => RegExp('error', 'i').test(line))
```
### 4.2 合规示例
```ts
const DIGITS = /^\d+$/                                   // 提升到循环外
for (const line of lines) {
  if (DIGITS.test(line)) { /* ... */ }
}

for (const line of lines) {
  const dynamic = new RegExp(line)                       // 模式依赖每次迭代的数据，不报
}
```

## 5. 例外/豁免
- `globalThis.RegExp(...)` 等非裸标识符形式的调用不在检测范围内。
- 与 `no-catastrophic-regex` 互补：前者关注模式本身是否会灾难性回溯，本规则关注构造时机。同一处常量正则若同时满足两者条件会各报一次，分别对应两个独立的修复动作。

## 6. 与工具的映射
- 规则 ID：`no-regexp-construction-in-hot-path`
- 规则实现：`packages/auto-cr-rules/src/rules/noRegexpConstructionInHotPath.ts`
- 启用方式：`auto-cr-cmd` 默认加载内置规则集并启用本规则；可在 `.autocrrc.json` 的 `rules` 中设为 `"off"` 或调整严重级别。

## 7. 版本与变更
- 当前规则版本参考包版本：`auto-cr-rules@2.0.121`
- 变更记录：
  - 2.0.121：新增规则，检测热路径中用常量模式构造正则。

## 8. 参考资料
- MDN：RegExp() constructor：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/RegExp
- V8：Regular expression literal caching（`/.../` 按出现位置缓存编译结果）
