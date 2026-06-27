# no-layer-violations / 分层依赖方向约束

## 1. 目的
- 约束代码只能按既定的层级方向依赖，例如 `app -> features -> shared`。
- 防止底层模块反向引用上层业务逻辑，避免架构逐渐失去边界。
- 默认不启用；需要在 `.autocrrc` 的 `rules` 中显式打开。

## 2. 适用范围
- JavaScript / TypeScript 源码中的静态 `import`、动态 `import()` 与 `require(...)`。
- 规则通过 `.autocrrc` 的 `ruleOptions["no-layer-violations"]` 提供层级配置。
- 支持两类匹配：
  - `paths`：匹配文件相对配置目录的路径，用于识别当前文件层级与相对导入目标。
  - `imports`：匹配别名导入字符串，用于识别如 `@shared/*` 这类路径别名。

## 3. 启用配置结构
```jsonc
{
  "rules": {
    "no-layer-violations": "warning"
  },
  "ruleOptions": {
    "no-layer-violations": {
      "layers": [
        {
          "name": "app",
          "paths": ["src/app/**"],
          "imports": ["@app/**"],
          "allow": ["features", "shared"]
        },
        {
          "name": "features",
          "paths": ["src/features/**"],
          "imports": ["@features/**"],
          "allow": ["shared"]
        },
        {
          "name": "shared",
          "paths": ["src/shared/**"],
          "imports": ["@shared/**"],
          "allow": []
        }
      ]
    }
  }
}
```

- `name`：层名，用于 `allow` 关系引用。
- `paths`：当前层包含的文件路径模式，基于 `.autocrrc*` 所在目录计算。
- `imports`：可选，当前层的 alias/import 字符串模式；使用路径别名时建议显式配置。
- `allow`：当前层允许依赖的目标层列表；未写时默认只允许同层。

## 4. 示例
### 4.1 违规示例
```ts
// src/shared/logger.ts
import { orderModel } from '@features/order/model'
```

### 4.2 合规示例
```ts
// src/app/index.ts
import { orderModel } from '@features/order/model'
import { formatCurrency } from '@shared/currency'
```

## 5. 行为说明
- 同层依赖默认允许。
- 若目标导入既不命中任何 `paths`，也不命中任何 `imports`，规则会忽略，避免把外部 npm 包误判成层级模块。
- 使用 alias 时，若希望规则识别 `@shared/*` 这类路径，请在对应层配置 `imports`。

## 6. 与工具的映射
- 规则 ID：`no-layer-violations`
- 规则实现：`packages/auto-cr-rules/src/rules/noLayerViolations.ts`
- 启用方式：`auto-cr-cmd` 默认加载内置规则集；通过 `.autocrrc` 的 `ruleOptions` 提供层级配置。

## 7. 版本与变更
- 当前规则版本参考包版本：`auto-cr-rules@2.0.117`
- 变更记录：
  - 2.0.117：新增规则文档，支持分层依赖方向校验。
