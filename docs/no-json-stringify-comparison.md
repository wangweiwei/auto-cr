# no-json-stringify-comparison / 禁止用 JSON.stringify 判断相等

## 1. 目的
- `JSON.stringify(a) === JSON.stringify(b)` 常被当作“深比较”的捷径，但它并不可靠：
  - 结果依赖属性插入顺序：`{ a: 1, b: 2 }` 与 `{ b: 2, a: 1 }` 内容相同，却会被判为不相等——比较的两边往往来自不同的构造路径（接口返回 vs 本地组装），于是出现“永远有变化”的重复渲染、重复写库；
  - 序列化有损：`undefined`、函数、`Symbol` 被丢弃，`NaN` / `Infinity` 变成 `null`，`Date` 变成字符串，`Map` / `Set` 变成 `{}`，内容不同的值可能得到相同的字符串；
  - 每次比较都要完整序列化两个对象，数据大时开销可观。
- ESLint 核心与主流插件都没有针对这种写法的规则。

## 2. 适用范围
- JavaScript / TypeScript 源码中所有 `===` / `==` / `!==` / `!=` 比较，两侧都是 `JSON.stringify(...)` 调用时。

## 3. 规则说明
- 约束：不得用两个 `JSON.stringify` 的结果判断相等。
- 判定方式：复用共享分析索引 `analysis.binaryExpressions`，筛选相等/不等比较，两侧（去掉括号与 TS 断言后）都是 `JSON.stringify(x)` 时上报。
- 任意一侧传了 replacer（第二个参数，且不是 `null` / `undefined` / `void 0`）时不报：数组形式的 replacer 会固定输出的键顺序，属于有意为之。
- 严重程度：warning（默认 tag：`base`）。
- 可配置项：当前版本无可配置参数；可通过配置文件关闭或调整严重级别。

## 4. 示例
### 4.1 违规示例
```ts
if (JSON.stringify(prevFilters) !== JSON.stringify(nextFilters)) {
  refetch()                                                // 键顺序不同就会误判为“有变化”
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
```
### 4.2 合规示例
```ts
import { isDeepStrictEqual } from 'node:util'

if (!isDeepStrictEqual(prevFilters, nextFilters)) {
  refetch()
}

const samePage = prev.page === next.page                   // 只比较关心的字段

const KEYS = ['page', 'status']
JSON.stringify(prev, KEYS) === JSON.stringify(next, KEYS)  // 数组 replacer 固定键顺序，不报

JSON.stringify(next) === snapshot                          // 与已有快照字符串比较，不在范围内
```

## 5. 例外/豁免
- 与序列化快照（字符串变量）比较不在检测范围内：那是另一种用法，快照本身的生成方式决定了比较是否稳定。
- 两侧对象确定由同一段代码按相同顺序构造、且不含上述有损类型时，比较结果碰巧可靠；但这种隐含前提很容易在后续修改中被打破，仍建议改为显式的深比较。

## 6. 与工具的映射
- 规则 ID：`no-json-stringify-comparison`
- 规则实现：`packages/auto-cr-rules/src/rules/noJsonStringifyComparison.ts`
- 启用方式：`auto-cr-cmd` 默认加载内置规则集并启用本规则；可在 `.autocrrc.json` 的 `rules` 中设为 `"off"` 或调整严重级别。

## 7. 版本与变更
- 当前规则版本参考包版本：`auto-cr-rules@2.0.124`
- 变更记录：
  - 2.0.124：新增规则，检测用 `JSON.stringify` 的结果判断相等；共享分析索引新增 `binaryExpressions`。

## 8. 参考资料
- MDN：JSON.stringify()（属性顺序与各类值的序列化规则）：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify
- Node.js：util.isDeepStrictEqual：https://nodejs.org/api/util.html#utilisdeepstrictequalval1-val2
