# 配置：.autocrrc（启用/关闭规则）

## 1. 作用
- 通过仓库根目录下的 `.autocrrc.json/.js` 统一开启、关闭或调整规则严重级别，覆盖内置与自定义规则。

## 2. 搜索顺序与 CLI 参数
- 默认在 `process.cwd()` 下按顺序查找：`.autocrrc.json` → `.autocrrc.js`。
- 使用 `--config <path>` 可指定其他路径（绝对或相对均可）。
- 路径匹配相对 `.autocrrc*` 文件所在目录进行计算。

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

---

# 忽略配置：.autocrignore（排除扫描路径）

## 1. 作用
- 类似 `.eslintignore`，用于排除不需要扫描的文件/目录（例如构建产物、第三方代码）。

## 2. 搜索顺序与 CLI 参数
- 默认在 `process.cwd()` 下查找：`.autocrignore.json` → `.autocrignore.js`。
- 使用 `--ignore-path <path>` 可指定其他忽略文件路径。
- 匹配基于忽略文件所在目录计算相对路径；同样会尝试匹配绝对路径。

## 3. 支持的写法
- JSON/JS：支持字符串数组或 `{ ignore: string[] }`。
  - JS/JSON 示例：
    ```js
    // .autocrignore.js
    module.exports = {
      ignore: [
        'node_modules',
        'dist/**',
        '**/*.test.ts'
      ]
    }
    ```

## 4. 模式说明
- 使用 glob 规则（基于 picomatch），`dot` 文件也会匹配：
  - `node_modules`、`dist/**`、`**/*.test.ts` 等。
- 匹配时同时尝试绝对路径和相对 `cwd` 的路径。
- 默认仍会跳过 `.d.ts` 文件；`node_modules` 目录也可通过忽略配置覆盖（默认递归时会跳过，但匹配到忽略规则时同样跳过）。
