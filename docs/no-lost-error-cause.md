# no-lost-error-cause / 禁止丢弃原始异常后另起新错

## 1. 目的
- `catch (error) { throw new Error('xxx failed') }` 会把原始异常整个丢掉：堆栈、消息、上游的 `cause` 链全部消失。
- 线上排障时只能看到一条"xxx failed"，却无法知道是网络超时、JSON 解析失败还是权限错误——问题被转述了一遍，但线索没有跟过来。

## 2. 适用范围
- JavaScript / TypeScript 源码中所有 `try` / `catch` 语句，包括嵌套的 `try`。
- 同步与异步代码一视同仁。

## 3. 规则说明
- 约束：`catch` 块内若有 `throw`，捕获到的异常必须在该块内被使用过。
- 判定方式：
  - 复用共享分析索引 `analysis.tryStatements`，逐个检查 `catch` 子句。
  - 捕获参数为省略形式（`catch { ... }`）时，原始异常在语法上就不可达，块内任何 `throw` 都视为违规。
  - 捕获参数为单个标识符时，在 `catch` 块内查找对它的引用（嵌套函数内的引用同样算数，例如回调里记录日志）。属性名 `obj.error` 与对象字面量的键 `{ error: 1 }` 不算引用。
  - 只统计会从当前 `catch` 路径直接抛出的 `throw`：嵌套函数/类内部的 `throw` 不在本次执行路径上；嵌套 `try` 内的 `throw` 归内层 `catch` 处理，内层 `try` 会被单独判定。
- 被引用即视为已处理：记录日志、`{ cause: error }` 包装、直接 `throw error` 透传都可以。本规则不判断"引用方式是否足够好"。
- 严重程度：warning（默认 tag：`base`）。
- 可配置项：当前版本无可配置参数；可通过配置文件关闭或调整严重级别。

## 4. 示例
### 4.1 违规示例
```ts
try {
  return await load()
} catch (error) {
  throw new Error('failed to load config') // error 从未被使用
}

try {
  return parse(raw)
} catch {
  throw new Error('failed to parse config') // 省略绑定，原始异常不可达
}
```
### 4.2 合规示例
```ts
try {
  return await load()
} catch (error) {
  throw new Error('failed to load config', { cause: error }) // 串联原始异常
}

try {
  return await load()
} catch (error) {
  logger.error('load failed', error) // 已记录
  throw new Error('failed to load config')
}
```

## 5. 例外/豁免
- 捕获参数为解构模式（如 `catch ({ message })`）时，取字段本身就是一种使用，不做判定。
- 本规则只要求"被使用"，不要求"用 `{ cause }`"。`throw new Error(error.message)` 引用了 `error`，不会上报，尽管它同样丢失了堆栈——如需更严格的约束，可在自定义规则中按 `NewExpression` 的参数判断。
- 与 `no-swallowed-errors` 的分工：前者要求 `catch` 里"做了事"，本规则要求做的事"没有丢掉原始异常"。两者互补，不会重复上报同一处。

## 6. 与工具的映射
- 规则 ID：`no-lost-error-cause`
- 规则实现：`packages/auto-cr-rules/src/rules/noLostErrorCause.ts`
- 启用方式：`auto-cr-cmd` 默认加载内置规则集并启用本规则；可在 `.autocrrc.json` 的 `rules` 中设为 `"off"` 或调整严重级别。

## 7. 版本与变更
- 当前规则版本参考包版本：`auto-cr-rules@2.0.121`
- 变更记录：
  - 2.0.121：新增规则，检测 `catch` 块内丢弃原始异常后抛出新错误的写法。

## 8. 参考资料
- MDN：Error() constructor — `cause` 选项：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/Error
- MDN：Error.prototype.cause：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause
- TC39 Error Cause 提案：https://github.com/tc39/proposal-error-cause
