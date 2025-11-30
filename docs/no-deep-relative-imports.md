# no-deep-relative-imports / 禁止深层相对路径导入

## 1. 目的
- 避免脆弱的多级 `../` 相对路径导致的可维护性与可读性问题，鼓励通过路径别名或上层聚合导出保持依赖清晰。

## 2. 适用范围
- JavaScript / TypeScript 源码中的 `import` / `export` 语句。
- 仅对相对路径导入生效；绝对路径或别名路径不受影响。

## 3. 规则说明
- 约束：相对导入的回溯层级（`../` 出现次数）不得大于 2；超过即判定为违规。
- 判定方式：基于 SWC AST 遍历导入语句，计算相对路径深度；超过阈值时在对应行报出违规并给出替代建议。
- 严重程度：warning（默认 tag：`base`）。
- 可配置项：当前版本固定 `maxDepth = 2`，无 CLI 侧配置开关；若需调整需自定义规则实现。

## 4. 示例
### 4.1 违规示例
```ts
import { helper } from '../../../../shared/utils/helper' // 回溯 4 级，超过限制
```
### 4.2 合规示例
```ts
import { helper } from '../../shared/utils/helper' // 回溯 2 级，符合限制
import { helper } from '@shared/utils/helper'      // 使用路径别名规避深层回溯
```

## 5. 例外/豁免
- 默认无豁免。若历史包结构难以调整，可在自定义规则中提升 `maxDepth` 或通过上层 `index.ts` 聚合导出逐步收敛路径。

## 6. 与工具的映射
- 规则 ID：`no-deep-relative-imports`
- 规则实现：`packages/auto-cr-rules/src/rules/noDeepRelativeImports.ts`
- 启用方式：`auto-cr-cmd` 默认加载内置规则集并启用本规则；当前版本无单独关闭开关。如需定制（如更改深度阈值或暂时禁用），可在自定义 `ruleDir` 中提供修改后的同名规则并使用 `--rule-dir` 加载自定义规则集。

## 7. 版本与变更
- 当前规则版本参考包版本：`auto-cr-rules@2.0.63`
- 变更记录：
  - 2.0.63：发布规则文档；规则默认限制回溯深度为 2。

## 8. 参考资料
- TypeScript 路径映射：https://www.typescriptlang.org/tsconfig#paths
- 代码库内部路径别名最佳实践（如有）
