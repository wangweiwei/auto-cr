# no-catastrophic-regex / 禁止热路径中的灾难性回溯正则

## 1. 目的
- `(a+)+$` 这类嵌套无限量词的正则，遇到不匹配的输入时回溯次数随长度指数增长——几十个字符就能让单次匹配跑上数秒，事件循环整个被卡住。
- 这也是 ReDoS（正则拒绝服务）的典型成因：只要输入可被外部控制，就是一个可被触发的拒绝服务点。

## 2. 适用范围
- 热路径（循环体与数组高阶方法回调）内的正则字面量 `/.../`，以及用字符串字面量或无插值模板字符串构造的 `new RegExp(...)` / `RegExp(...)`。
- 动态拼接的模式不做分析。热路径之外的正则不在范围内——同样的模式放在热路径里影响被成倍放大，本规则聚焦于此。

## 3. 规则说明
- 约束：热路径中的正则不得出现"嵌套无限量词"。
- 判定方式（一次线性扫描模式字符串）：
  - 无限量词指 `+`、`*`、`{m,}`（含其惰性形式 `+?` 等）；`?`、`{m}`、`{m,n}` 有上限，不算。
  - 某个分组内部出现了无限量词，且该分组自身又紧跟一个无限量词，即判定为违规，例如 `(a+)+`、`([a-z]+)*`、`(\d+){2,}`。
  - 内层分组的"含无限量词"状态会向外层传播，因此 `((a+)b)+` 同样命中。
  - 正确处理转义（`\+` 不是量词）与字符类（`[+*]` 内的符号不是量词）。
- 该条件是灾难性回溯的**必要条件而非充分条件**：命中意味着"可能"，不意味着"一定"。例如 `(\d+\.)+` 中每轮必须以 `.` 结尾，实际没有歧义，但仍会被报出（见第 5 节）。
- 严重程度：optimizing（默认 tag：`performance`）。
- 可配置项：当前版本无可配置参数；可通过配置文件关闭或调整严重级别。

## 4. 示例
### 4.1 违规示例
```ts
for (const sample of samples) {
  if (/(a+)+$/.test(sample)) { /* ... */ }          // 嵌套无限量词
}
inputs.forEach((value) => new RegExp('(a+)+$').test(value))
```
### 4.2 合规示例
```ts
for (const sample of samples) {
  if (/a+$/.test(sample)) { /* ... */ }             // 去掉多余的外层分组量词
  if (/(?:a{1,3}b)+/.test(sample)) { /* ... */ }    // 内层量词有上限
}
```

## 5. 例外/豁免
- 只检测语法上的嵌套量词。重叠分支（`(a|a)+`、`(a|ab)+`）与 `(.*a){n}` 一类同样会回溯爆炸的模式**不在检测范围内**。
- 形如 `(?:[a-z]+\.)+[a-z]+`（域名匹配）的模式会被报出，但因各轮以固定分隔符结尾，实际不会灾难性回溯；确认无歧义后可在配置中关闭本规则，或改写为无嵌套量词的等价形式。
- 与 `no-regexp-construction-in-hot-path` 互补：前者关注构造时机，本规则关注模式本身；同一处常量正则可能同时得到两条报告，对应两个独立的修复动作。

## 6. 与工具的映射
- 规则 ID：`no-catastrophic-regex`
- 规则实现：`packages/auto-cr-rules/src/rules/noCatastrophicRegex.ts`（模式提取逻辑位于 `rules/utils/regexp.ts`）
- 启用方式：`auto-cr-cmd` 默认加载内置规则集并启用本规则；可在 `.autocrrc.json` 的 `rules` 中设为 `"off"` 或调整严重级别。

## 7. 版本与变更
- 当前规则版本参考包版本：`auto-cr-rules@2.0.121`
- 变更记录：
  - 2.0.121：补充规则文档；`RegExp` 参数提取逻辑抽为共享工具，行为不变。

## 8. 参考资料
- OWASP：Regular expression Denial of Service - ReDoS：https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS
- MDN：Regular expressions — Quantifiers：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Quantifier
