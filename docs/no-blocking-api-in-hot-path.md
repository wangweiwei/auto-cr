# no-blocking-api-in-hot-path / 禁止在热路径中调用阻塞式 API

## 1. 目的
- 避免在循环、数组高阶回调等热路径中反复调用阻塞式 Node.js API，导致事件循环卡顿与吞吐下降。
- 与全局禁用同步 API 不同，本规则只关注“重复执行”的场景，减少对启动脚本或一次性初始化代码的噪声。

## 2. 适用范围
- JavaScript / TypeScript 源码中的 `for` / `while` / `forEach` / `map` / `reduce` 等热路径。
- 当前版本重点覆盖以下模块的阻塞式 API：
  - `fs`
  - `child_process`
  - `crypto`
  - `zlib`
- 支持以下常见写法：
  - `fs.readFileSync(...)`
  - `import { readFileSync } from 'fs'`
  - `import { execSync } from 'child_process'`
  - `const { gzipSync } = require('zlib')`
  - `const fsSync = fs; fsSync.statSync(...)`
  - 局部作用域中的同名变量或参数会被正确遮蔽，不会按模块 API 误报

## 3. 规则说明
- 约束：若阻塞式 API 调用位于热路径中，则判定为违规。
- 判定方式：
  - 先复用共享分析结果识别热路径内的调用点。
  - 再结合作用域内的 `import` / `require` 绑定，判断当前调用是否命中了阻塞式 Node API。
- 严重程度：optimizing（默认 tag：`performance`）。
- 可配置项：当前版本无单独配置项；若需增减 API 白名单，可在自定义规则目录中提供同名规则覆盖实现。

## 4. 示例
### 4.1 违规示例
```ts
import fs from 'fs'
import { execSync } from 'child_process'

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8')
  console.log(content.length)
}

files.forEach((file) => {
  execSync(`wc -l ${file}`)
})
```

### 4.2 合规示例
```ts
import { readFile } from 'fs/promises'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

await Promise.all(files.map((file) => readFile(file, 'utf8')))
await Promise.all(files.map((file) => execAsync(`wc -l ${file}`)))
```

## 5. 例外/豁免
- 启动期的一次性同步读取通常不在本规则关注范围内，例如加载配置文件。
- 若确有必须保留的阻塞调用，建议先移出循环或批处理路径，再评估是否需要做更精细的豁免。

## 6. 与工具的映射
- 规则 ID：`no-blocking-api-in-hot-path`
- 规则实现：`packages/auto-cr-rules/src/rules/noBlockingApiInHotPath.ts`
- 启用方式：`auto-cr-cmd` 默认加载内置规则集并启用本规则。

## 7. 版本与变更
- 当前规则版本参考包版本：`auto-cr-rules@2.0.117`
- 变更记录：
  - 2.0.117：新增规则文档，检测热路径中的阻塞式 Node API 调用。

## 8. 参考资料
- Node.js Event Loop：https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop
- Node.js `fs` API：https://nodejs.org/api/fs.html
