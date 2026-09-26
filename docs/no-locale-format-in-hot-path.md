# no-locale-format-in-hot-path / 禁止在热路径中带参数调用本地化格式化方法

## 1. 目的
- `value.toLocaleString('zh-CN', { style: 'currency', currency: 'CNY' })`、`date.toLocaleDateString('zh-CN', {...})`、`a.localeCompare(b, 'zh', {...})` 每次调用都要按参数重新协商 locale、加载本地化数据并创建一个一次性的格式化器/排序器。
- 放在表格渲染、列表映射这类循环里，开销会非常可观。在 Node 22 上实测 2 万次调用：`toLocaleString` 约 680ms，复用一个 `Intl.NumberFormat` 调 `format()` 约 15ms；`toLocaleDateString` 约 1250ms，复用 `Intl.DateTimeFormat` 约 37ms。
- MDN 对这几个方法都有同样的建议：同样的参数被大量调用时，创建一次 `Intl` 对象并复用。

## 2. 适用范围
- JavaScript / TypeScript 源码中的热路径：循环体（`for` / `for...of` / `for...in` / `while` / `do...while`）与数组高阶方法回调（`map` / `forEach` / `filter` 等）。数组高阶方法经可选链调用时（`items?.map((x) => ...)`、`items.map?.((x) => ...)`），回调同样属于热路径；回调外层的括号或 TS 断言（`items.map(((x) => ...) as Mapper)`）不影响判定。
- 覆盖的方法：`toLocaleString(locales, options)`、`toLocaleDateString(locales, options)`、`toLocaleTimeString(locales, options)`、`localeCompare(other, locales, options)`。

## 3. 规则说明
- 约束：热路径中不得以不变的 locale / options 调用上述方法。
- 判定方式：
  - 复用共享分析的循环与回调索引，按作用域遍历热路径中的调用。
  - 只看 locale / options 参数（`localeCompare` 从第二个参数算起）：至少有一个不是 `undefined` / `void 0`，且全部在迭代之间不变（字面量，或未在本轮绑定、未被修改或传给未知函数、未在文件中被重新赋值的变量；作用域内有 `await` / `yield` 时引用变量的参数不算不变）时才上报。
  - 位于 `throw`（外层没有 `try`）或循环中 `return` 语句里的调用不报：每次进入作用域至多执行一次。
  - 不带参数的调用不报：引擎通常会缓存默认格式化器。locale / options 随迭代变化（例如 `row.amount.toLocaleString(row.locale)`）时也不报：无法简单提升，需要按 locale 做缓存。
- 直接写 `new Intl.NumberFormat(...)` 的情况已有 ESLint 插件覆盖（react-doctor 的 `js-hoist-intl`），排序比较函数中的 `localeCompare` 也有 `@e18e/prefer-static-collator`，本规则不重复这两类。
- 严重程度：optimizing（默认 tag：`performance`）。
- 可配置项：当前版本无可配置参数；可通过配置文件关闭或调整严重级别。

## 4. 示例
### 4.1 违规示例
```ts
const amounts = rows.map((row) => row.amount.toLocaleString('zh-CN', { style: 'currency', currency: 'CNY' }))

for (const row of rows) {
  print(row.createdAt.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }))
}

const matches = rows.filter((row) => row.name.localeCompare(query, 'zh', { sensitivity: 'base' }) === 0)
```
### 4.2 合规示例
```ts
const currency = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' })
const amounts = rows.map((row) => currency.format(row.amount))

const collator = new Intl.Collator('zh', { sensitivity: 'base' })
const matches = rows.filter((row) => collator.compare(row.name, query) === 0)

rows.map((row) => row.amount.toLocaleString())             // 不带参数，不报
rows.map((row) => row.amount.toLocaleString(row.locale))   // locale 逐行变化，不报
```

## 5. 例外/豁免
- 规则不校验接收者类型：自定义对象上同名的 `toLocaleString(...)` 方法也会被报出，可在对应位置关闭本规则。
- options 对象在循环体内用字面量重新声明（`const opts = {...}`）时，按“每轮新绑定”处理而不上报；把 options 与格式化器一起提升到循环外即可。
- 经由别名修改 options（`const o = opts; o.currency = row.currency`）静态分析看不到，此时会误报，可在该处关闭本规则。

## 6. 与工具的映射
- 规则 ID：`no-locale-format-in-hot-path`
- 规则实现：`packages/auto-cr-rules/src/rules/noLocaleFormatInHotPath.ts`
- 启用方式：`auto-cr-cmd` 默认加载内置规则集并启用本规则；可在 `.autocrrc.json` 的 `rules` 中设为 `"off"` 或调整严重级别。

## 7. 版本与变更
- 当前规则版本参考包版本：`auto-cr-rules@2.0.124`
- 变更记录：
  - 2.0.124：新增规则，检测热路径中带 locale / options 调用的本地化格式化方法。

## 8. 参考资料
- MDN：Number.prototype.toLocaleString（Performance）：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/toLocaleString#performance
- MDN：Date.prototype.toLocaleDateString（Performance）：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toLocaleDateString#performance
- MDN：String.prototype.localeCompare（Performance）：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/localeCompare#performance
