# auto-cr-cmd(Auto Code Review Command)

## 概述
auto-cr-cmd是一个基于 AST（抽象语法树）分析的命令行工具，用于检查代码是否符合预定义的规则集。它支持灵活定制规则，并可集成到 CI/CD 流程中，助力团队实现代码质量的自动化管控

## 功能特性

✅ ​AST 分析​：通过解析代码的抽象语法树深度检测代码结构 </br>
✅ 规则定制​：支持用户自定义规则 </br>
⬜ report 定制接口 </br>
⬜ 集成到 CI/CD 流程 </br>
…… </br>

## 安装方式
### 通过包管理器安装
```bash
npm install -g auto-cr-cmd
```
### 从源码编译
```bash
git clone https://github.com/your-repo/auto-cr-cmd.git
cd auto-cr-cmd
pnpm install
pnpm build
```

## 自定义规则
1. 编写规则
```javascript
// rules/my-rules.js
module.exports = function (api, options) {
    // 从插件参数中获取 report 方法
    const { report } = options;
  
    return {
      name: "my-custom-plugin",
      visitor: {
        // 遍历 FunctionDeclaration 节点
        FunctionDeclaration(path) {
          const functionName = path.node.id.name;
          // 执行业务逻辑
          if (functionName === "badFunction") {
            // 通过 report 上报问题
            report(path, "Function name 'badFunction' is not allowed.");
          }
        },
      },
    };
  }
```
2. 将规则文件放入指定目录，然后执行如下命令即可
```bash
npx auto-cr-cmd -r xxxx/rules xxx/src
```
* [paths...] 需要扫描的文件或目录路径列表
* -r 自定义规则目录路径

## 贡献方式
欢迎提交 Issue 或 Pull Request：
* Fork 本项目
* 为[auto-cr-rules](https://github.com/wangweiwei/auto-cr-rules)添加新规则或优化现有规则
* 测试通过后提交 PR
