# no-lossy-error-serialization / 禁止以丢失信息的方式序列化错误对象

## 1. 目的
- `Error` 的 `message`、`stack`、`cause` 都是**不可枚举**的自有属性，而 `JSON.stringify`、对象展开 `{ ...err }` 与 `Object.assign` 只处理可枚举属性。于是：
  - `logger.error(JSON.stringify(err))` 输出 `{}`；
  - `res.status(500).json(err)` 让客户端收到 `{}`；
  - `report({ ...err, requestId })` 只剩下 `requestId` 和少数自定义字段。
- 这类代码能正常运行、不报错，却让线上排障时最关键的信息悄悄消失。ESLint 核心与主流插件都没有对应规则。

## 2. 适用范围
- 被识别为“错误对象”的绑定：
  - `catch (err)` 的参数；
  - `promise.catch((err) => ...)` 与 `promise.then(onOk, (err) => ...)` 中拒绝回调的第一个参数；
  - 作为回调传入、第一个参数名为 `err` / `error` 的函数（Node 风格回调，如 `fs.readFile(p, (err, data) => ...)`）。参数带有明显不是错误的类型标注（如 `error: string`）时除外。
- 在上述绑定的作用域内检查以下用法：
  - `JSON.stringify(err)`，以及把错误作为属性值的 `JSON.stringify({ err })` / `JSON.stringify({ error: err })`；
  - 对象展开 `{ ...err }`；
  - `Object.assign(target, err)`；
  - `xxx.json(err)` / `xxx.json({ error: err })`（Express、Hono、`Response.json`、`NextResponse.json` 内部都是 `JSON.stringify`），以及 Express 的 `res.send(err)` / `response.send(err)`。

## 3. 规则说明
- 约束：不得用只处理可枚举属性的方式序列化/复制错误对象。
- 判定方式：
  - 错误绑定来自共享分析索引 `analysis.tryStatements` 与 `analysis.callExpressions`，只遍历这些绑定所在的函数体/catch 块。
  - 嵌套函数或嵌套 catch 重新绑定同名参数时，内部的同名标识符不再视为该错误对象。
  - 以下写法视为作者已处理不可枚举属性，不报：`JSON.stringify` 传了 replacer（如 `JSON.stringify(err, Object.getOwnPropertyNames(err))`）；对象字面量里同时显式写了 `message` 或 `stack` 键。
- 严重程度：warning（默认 tag：`base`）。
- 可配置项：当前版本无可配置参数；可通过配置文件关闭或调整严重级别。

## 4. 示例
### 4.1 违规示例
```ts
try {
  JSON.parse(input)
} catch (err) {
  logger.error(`parse failed: ${JSON.stringify(err)}`)    // 输出 parse failed: {}
}

try {
  await doWork()
} catch (error) {
  res.status(500).json(error)                             // 客户端收到 {}
}

doWork().catch((reason) => {
  logger.error('failed', { ...reason, requestId })        // message / stack 不见了
})
```
### 4.2 合规示例
```ts
try {
  JSON.parse(input)
} catch (err) {
  logger.error('parse failed', err)                       // 直接交给日志库，由其展开 message / stack
  logger.error(JSON.stringify({ message: err.message, stack: err.stack }))
  logger.error(JSON.stringify(err, Object.getOwnPropertyNames(err)))
}

res.status(500).json({ message: error.message })           // 只返回需要暴露给客户端的字段
```

## 5. 例外/豁免
- 自定义了 `toJSON()` 的错误类（例如 axios 的 `AxiosError`）经 `JSON.stringify` 可以得到有用的内容，但规则无法静态得知，仍会上报；确认是这类错误时可在该处关闭本规则。
- Fastify 的 `reply.send(err)` 会专门处理 Error，不在检测范围内。
- 第一个参数名为 `err` / `error` 但实际不是 Error 的回调（例如事件载荷恰好叫 error）也可能被误报；为其补充类型标注即可排除。

## 6. 与工具的映射
- 规则 ID：`no-lossy-error-serialization`
- 规则实现：`packages/auto-cr-rules/src/rules/noLossyErrorSerialization.ts`
- 启用方式：`auto-cr-cmd` 默认加载内置规则集并启用本规则；可在 `.autocrrc.json` 的 `rules` 中设为 `"off"` 或调整严重级别。

## 7. 版本与变更
- 当前规则版本参考包版本：`auto-cr-rules@2.0.124`
- 变更记录：
  - 2.0.124：新增规则，检测以丢失 `message` / `stack` 的方式序列化错误对象；共享分析索引新增 `callExpressions`。

## 8. 参考资料
- ECMAScript：Error ( message [ , options ] )（`message` / `cause` 以不可枚举属性创建）：https://tc39.es/ecma262/#sec-error-message
- MDN：JSON.stringify()（只序列化可枚举的自有属性）：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify
- Express：res.json()：https://expressjs.com/en/api.html#res.json
