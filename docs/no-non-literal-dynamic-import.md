# no-non-literal-dynamic-import / 禁止非字面量的动态导入

## 1. 目的
- `import(pluginName)`、`require(base + '/x')` 这类说明符在构建期无法确定，打包器要么放弃解析（运行时 "module not found"），要么退而把整个目录打进产物（webpack 的 context module），代码分割与 tree-shaking 随之失效。
- 本工具的依赖图（`no-circular-dependencies` 等）同样看不到这条边，相关规则对它静默失效。

## 2. 适用范围
- JavaScript / TypeScript 源码中的动态 `import()` 与 `require()` 调用（含 `require.resolve()`）。
- **默认关闭**。Node 工具里按路径加载配置文件或插件是惯用写法，本规则面向需要打包的项目，请按需开启。

## 3. 启用与规则说明
```jsonc
{
  "rules": {
    "no-non-literal-dynamic-import": "warning"
  }
}
```
- 约束：`import()` / `require()` 的说明符应能被静态解析。
- 判定方式：
  - 复用共享分析索引 `analysis.nonLiteralImports`：共享遍历在提取 import 索引时，把说明符不是字符串字面量的 `import()` / `require()` 单独记录下来（连同参数表达式）。
  - 以下两种参数视为可静态解析，不报：无插值的模板字符串（本质是常量）；带静态相对前缀 `./` 或 `../` 的模板字符串（`import(\`./locales/${lang}.js\`)`），这是 webpack / Vite 明确支持的形式。
  - 其余一切——变量、字符串拼接、不带相对前缀的插值模板——都视为不可静态解析。
- 严重程度：warning（默认 tag：`base`），默认关闭。
- 可配置项：当前版本无可配置参数。

## 4. 示例
### 4.1 违规示例
```ts
import(pluginName)                          // 变量
import(base + '/entry.js')                  // 拼接
import(`${base}/locales/${lang}.js`)        // 插值模板，但前缀不是 ./ 或 ../
require(pluginName)
```
### 4.2 合规示例
```ts
import('./static-module')                   // 字面量
import(`./locales/${lang}.js`)              // 静态相对前缀，打包器按目录上下文处理
flag ? import('./a') : import('./b')        // 条件加载：每个分支一个字面量
```

## 5. 例外/豁免
- 静态相对前缀的模板字符串虽被放行，但各打包器仍有附加约束（Vite 要求写明扩展名、变量不能跨越目录层级等），请对照所用打包器文档。
- Node 侧的插件/配置加载（如 `require(configPath)`）属于有意为之的动态加载，这也是本规则默认关闭的原因；若在同一仓库中混有需要打包的前端代码，可只对前端目录启用本规则。

## 6. 与工具的映射
- 规则 ID：`no-non-literal-dynamic-import`
- 规则实现：`packages/auto-cr-rules/src/rules/noNonLiteralDynamicImport.ts`
- 启用方式：默认关闭；在 `.autocrrc.json` 的 `rules` 中设为 `"warning"` 或 `"error"` 开启。

## 7. 版本与变更
- 当前规则版本参考包版本：`auto-cr-rules@2.0.121`
- 变更记录：
  - 2.0.121：新增规则（默认关闭），并在共享分析索引中新增 `nonLiteralImports`。

## 8. 参考资料
- webpack：Dynamic expressions in import()：https://webpack.js.org/api/module-methods/#dynamic-expressions-in-import
- Vite：Dynamic Import：https://vite.dev/guide/features.html#dynamic-import
