# no-n2-array-lookup / 禁止热路径中的线性查找

## 1. 目的
- 在循环里对另一个数组做 `includes` / `find` / `indexOf`，每轮都是一次线性扫描，整体变成 O(n·m)；两个几千元素的数组就是上千万次比较。
- 把被查找的一方预先放进 `Set` / `Map`，同样的逻辑降为 O(n)。

## 2. 适用范围
- 热路径（循环体与数组高阶方法回调）内的方法调用，方法名属于：`find`、`findIndex`、`filter`、`some`、`every`、`includes`、`indexOf`、`lastIndexOf`。
- 同时覆盖 `obj.method(...)` 与 `obj['method'](...)` 两种写法。

## 3. 规则说明
- 约束：热路径中不得对数组做线性查找。
- 判定方式：复用共享分析索引 `analysis.hotPath.callExpressions`，按方法名匹配；`filter` / `some` / `every` 虽不返回单个元素，同样是整段线性扫描，一并计入。
- **不校验接收者的类型**：静态分析无法可靠得知 `x.includes(...)` 的 `x` 是数组还是字符串。因此字符串上的 `includes` / `indexOf`、以及只有两三个元素的常量数组同样会被报出（见第 5 节）。
- 严重程度：optimizing（默认 tag：`performance`）。
- 可配置项：当前版本无可配置参数；可通过配置文件关闭或调整严重级别。

## 4. 示例
### 4.1 违规示例
```ts
for (const order of orders) {
  if (catalog.includes(order)) { /* ... */ }       // 每轮线性扫描 catalog
}
users.map((user) => ids.find((id) => id === user.id))
```
### 4.2 合规示例
```ts
const catalogSet = new Set(catalog)                 // 循环外建一次索引
for (const order of orders) {
  if (catalogSet.has(order)) { /* ... */ }          // O(1)
}
const idSet = new Set(ids)
users.map((user) => (idSet.has(user.id) ? user.id : null))
```

## 5. 例外/豁免
- 字符串方法与数组方法同名，`text.indexOf('\n', pos)` 之类的字符串操作会被报出；若搜索起点逐轮前移（总体仍是线性），属于误报，可按需关闭。
- 被查找的数组很小且固定（如三五个枚举值）时，线性查找在数值上无感，是否改写可自行权衡。
- `Set.prototype.has` / `Map.prototype.get` 不在方法列表里，是推荐的替代写法。

## 6. 与工具的映射
- 规则 ID：`no-n2-array-lookup`
- 规则实现：`packages/auto-cr-rules/src/rules/noN2ArrayLookup.ts`
- 启用方式：`auto-cr-cmd` 默认加载内置规则集并启用本规则；可在 `.autocrrc.json` 的 `rules` 中设为 `"off"` 或调整严重级别。

## 7. 版本与变更
- 当前规则版本参考包版本：`auto-cr-rules@2.0.121`
- 变更记录：
  - 2.0.121：补充规则文档，行为不变。

## 8. 参考资料
- MDN：Set：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set
- MDN：Array.prototype.includes()：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/includes
