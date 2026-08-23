# no-test-import-in-prod / 禁止生产代码导入测试模块

## 1. 目的
- 生产代码一旦 `import` 了 `*.test.ts`、`__tests__/`、`__mocks__/` 之类的模块，测试夹具、mock 乃至整个测试框架都会被一起打进生产包。
- 这类错误往往是 IDE 自动补全引入的（同名符号恰好在测试 helper 里），编译能过、测试能过，只在包体积或线上行为上露出端倪。

## 2. 适用范围
- JavaScript / TypeScript 源码中的所有模块引用：静态 `import`、动态 `import()`、`require()`、`export ... from` 再导出。
- 导入方自身是测试文件时跳过：测试引用 mock / 夹具是正常行为。

## 3. 规则说明
- 约束：非测试文件不得引用测试专用模块。
- 判定方式：
  - 相对路径先解析到真实文件，再按**相对于项目根**的路径判断——直接用绝对路径会被仓库自身所在目录名（例如检出在 `/home/ci/test/` 下）误伤。解析不到或非相对路径时，退回到按说明符本身匹配，目录名通常就写在路径里。
  - 目录判定只看路径中的目录段，不含文件名本身，因此名为 `test.ts` 的生产模块不会被误判；文件名判定去掉源码扩展名后比较后缀，`foo.test.ts` 与未带扩展名的 `./foo.test` 结论一致。
  - 项目根取 `configDir`（配置文件所在目录），没有配置文件时向上寻找 `pnpm-workspace.yaml` 或最近的 `package.json`。
- 严重程度：warning（默认 tag：`architecture`）。
- 可配置项（`ruleOptions`）：
  - `directories`：视为测试目录的目录名列表，默认 `["__tests__", "__mocks__", "__fixtures__", "test", "tests", "spec"]`。
  - `suffixes`：视为测试文件的文件名后缀（`.` 之后的部分），默认 `["test", "spec"]`。
  - 两项都是整体替换而非追加；缺省或非法时退回默认值。

```jsonc
{
  "rules": { "no-test-import-in-prod": "error" },
  "ruleOptions": {
    "no-test-import-in-prod": {
      "directories": ["__tests__", "__mocks__", "testing"],
      "suffixes": ["test", "spec", "stories"]
    }
  }
}
```

## 4. 示例
### 4.1 违规示例
```ts
// src/service.ts
import { makeUser } from './__tests__/helpers'   // 测试目录
import { fakeDb } from './__mocks__/db'           // mock 目录
import { sampleUsers } from '../test/fixtures'    // 顶层 test 目录
export { expectUser } from './assertions.spec'    // 再导出 spec 文件
const lazy = () => import('./utils.spec')         // 动态导入同样检测
```
### 4.2 合规示例
```ts
// src/service.test.ts —— 导入方是测试文件，不做判定
import { makeUser } from './__tests__/helpers'

// src/__tests__/helpers.ts —— 测试引用生产代码是正常方向
import type { User } from '../types'

// src/service.ts —— 共用逻辑放在非测试目录
import { buildUser } from './factories/user'
```

## 5. 例外/豁免
- 通过 tsconfig `paths` 别名**隐藏**了目录名的引用（如 `"@fixtures/*": ["test/fixtures/*"]`）当前无法识别；别名里仍带目录名的（如 `@/__tests__/helper`）可以命中。
- 裸包名形式的测试框架（如 `import 'vitest'`）不在本规则范围内，那是"测试框架依赖"而非"测试文件依赖"。
- 若项目把可复用的测试工具有意放在 `test/` 下供生产引用，请把该目录从 `directories` 中移除，或把工具移到非测试目录。

## 6. 与工具的映射
- 规则 ID：`no-test-import-in-prod`
- 规则实现：`packages/auto-cr-rules/src/rules/noTestImportInProd.ts`
- 启用方式：`auto-cr-cmd` 默认加载内置规则集并启用本规则；可在 `.autocrrc.json` 的 `rules` 中设为 `"off"` 或调整严重级别，`ruleOptions` 中调整目录与后缀。

## 7. 版本与变更
- 当前规则版本参考包版本：`auto-cr-rules@2.0.121`
- 变更记录：
  - 2.0.121：新增规则，检测生产代码对测试文件与测试目录的引用。

## 8. 参考资料
- Jest：`__mocks__` 与 `__tests__` 目录约定：https://jestjs.io/docs/manual-mocks
- Vitest：测试文件命名约定：https://vitest.dev/config/#include
