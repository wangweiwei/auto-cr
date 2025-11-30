# 配置：.autocrrc（启用/关闭规则）

## 1. 作用
- 通过仓库根目录下的 `.autocrrc.json/.js/.cjs` 统一开启、关闭或调整规则严重级别，覆盖内置与自定义规则。

## 2. 搜索顺序与 CLI 参数
- 默认在 `process.cwd()` 下按顺序查找：`.autocrrc.json` → `.autocrrc.js` → `.autocrrc.cjs`。
- 使用 `--config <path>` 可指定其他路径（绝对或相对均可）。

## 3. 配置结构
```jsonc
{
  "rules": {
    "<rule-id>": "<setting>"
  }
}
```
- `rules`：键为规则 ID（如 `no-deep-relative-imports`），值为严重级别或开关。

### 3.1 规则值支持的写法
- 关闭：`"off"` | `false` | `0`
- 警告：`"warn"` / `"warning"` | `1`
- 错误：`"error"` | `2`
- 优化提示：`"optimizing"`
- 使用默认级别：`true` 或省略该规则
- 不合法的值会被忽略并输出警告。

## 4. 示例
### 4.1 JSON 版本
```jsonc
// .autocrrc.json
{
  "rules": {
    "no-deep-relative-imports": "error",
    "no-swallowed-errors": "off"
  }
}
```

### 4.2 JS 版本
```js
// .autocrrc.js
module.exports = {
  rules: {
    'no-swallowed-errors': 'warning', // 覆盖为警告
    'no-deep-relative-imports': true  // 保持默认严重级别
  }
}
```

## 5. 行为说明
- 未写明的规则沿用自身默认严重级别。
- 当配置关闭所有规则时，扫描将直接跳过并提示警告。
- 配置文件不存在、无法解析或字段类型不正确时，会输出警告并继续使用默认规则设置。
