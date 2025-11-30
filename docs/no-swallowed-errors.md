# no-swallowed-errors / 禁止吞掉错误

## 1. 目的
- 避免空的 `catch` / `finally` 块默默吞掉异常，导致问题被掩盖且难以追踪。

## 2. 适用范围
- JavaScript / TypeScript 源码中的 `try` / `catch` / `finally` 语句。
- 同时覆盖同步与异步代码（例如 `await` 包裹的逻辑）。

## 3. 规则说明
- 约束：`catch` 与 `finally` 中至少有一个包含可执行语句；二者皆为空时视为违规。
- 判定方式：遍历 AST 中的 `TryStatement`，检查 `catch` 与 `finally` 语句块是否存在可执行语句（空语句与仅包含空块的情况视为无效处理）。
- 严重程度：warning（默认 tag：`base`）。
- 可配置项：当前版本无可配置参数与开关；需变更行为时请自定义规则实现。

## 4. 示例
### 4.1 违规示例
```ts
try {
  await doWork()
} catch (error) {
  // nothing here -> 异常被吞掉
} finally {
  // 也为空 -> 未做任何处理
}
```
### 4.2 合规示例
```ts
try {
  await doWork()
} catch (error) {
  console.error('doWork failed', error)
  throw error // 记录并继续抛出
} finally {
  cleanup()
}
```

## 5. 例外/豁免
- 默认无豁免。若确需忽略异常，应显式写出处理意图（如 `console.warn`、指标打点、`throw` / `return` / `void error` 等），以表明异常已被有意识地处理。

## 6. 与工具的映射
- 规则 ID：`no-swallowed-errors`
- 规则实现：`packages/auto-cr-rules/src/rules/noSwallowedErrors.ts`
- 启用方式：`auto-cr-cmd` 默认加载内置规则集并启用本规则；当前无单独关闭开关。如需替换或禁用，可在自定义 `ruleDir` 中提供修改后的同名规则，并使用 `--rule-dir` 指定自定义规则目录。

## 7. 版本与变更
- 当前规则版本参考包版本：`auto-cr-rules@2.0.63`
- 变更记录：
  - 2.0.63：发布规则文档；规则要求 `catch` / `finally` 至少存在一处有效处理。

## 8. 参考资料
- MDN：try...catch：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/try...catch
- 错误处理与日志最佳实践（如有内部规范）
