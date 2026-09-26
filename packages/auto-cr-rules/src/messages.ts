import type { Language, RuleMessages } from './types'

// 规则文案多语言表（由 rules 通过 messages 接口访问）。
const ruleTranslations: Record<Language, RuleMessages> = {
  zh: {
    noDeepRelativeImports: ({ value, maxDepth }) => `导入路径 "${value}"，不能超过最大层级${maxDepth}`,
    swallowedError: () => '捕获到的异常未被重新抛出或记录，可能导致问题被静默吞噬。',
    circularDependency: ({ chain }) => `检测到循环依赖: ${chain}`,
    unresolvedImport: ({ value }) =>
      `无法解析导入 "${value}"，请检查 tsconfig paths/baseUrl/rootDirs 或 package.json exports。`,
    noLayerViolations: ({ fromLayer, toLayer, value }) =>
      `层级 "${fromLayer}" 不允许依赖层级 "${toLayer}"，请检查导入 "${value}"。`,
    noCrossPackagePrivateImports: ({ value, packageName }) =>
      `跨包导入 "${value}" 直接访问了工作区包 "${packageName}" 的私有实现，请改用公开导出入口。`,
    noCatastrophicRegex: ({ pattern }) => `热路径正则包含嵌套的无限量词，可能引发灾难性回溯: ${pattern}`,
    noBlockingApiInHotPath: ({ api }) => `热路径中调用阻塞式 API ${api}，可能反复阻塞事件循环。`,
    noDeepCloneInLoop: () => '热路径中使用深拷贝（structuredClone 或 JSON.parse(JSON.stringify)），可能造成明显开销。',
    noN2ArrayLookup: ({ method }) => `热路径中使用线性查找方法 ${method}，可能导致 O(n^2) 访问。`,
    noAsyncForEach: () =>
      'forEach 不会等待 async 回调：调用方会在回调完成前继续执行，回调内抛出的异常也会变成未处理的 Promise rejection。',
    noAccumulatingSpread: ({ name }) =>
      `热路径中对累加器 "${name}" 使用展开语法，每次迭代都会复制整个累加器，导致 O(n^2) 开销。`,
    noLostErrorCause: ({ name }) =>
      `catch 块中抛出了新错误，但捕获到的异常${name ? ` "${name}"` : ''}从未被使用，原始错误的堆栈与上下文会随之丢失。`,
    noTestImportInProd: ({ value }) =>
      `生产代码导入了测试专用模块 "${value}"，测试夹具、mock 或测试框架会被打进生产包。`,
    noSelfPackageImport: ({ value, packageName }) =>
      `通过包名 "${value}" 导入了自己所在的包 "${packageName}"，会绕过源码解析到安装/构建产物，造成代码陈旧、模块双实例与隐式循环。`,
    noRegexpConstructionInHotPath: ({ pattern }) =>
      `热路径中用常量模式构造正则 "${pattern}"，每次迭代都会重新编译；请提升到循环/回调外复用。`,
    noAwaitInLoop: () => '循环体内逐次 await，每轮都要等上一轮完成；若各轮互不依赖，可改为并发执行。',
    noNonLiteralDynamicImport: ({ form }) =>
      `${form} 的模块说明符不是字面量，打包器无法静态解析：要么运行时找不到模块，要么被迫把整个目录打进产物，依赖分析也看不到这条边。`,
    noCollectionRebuildInHotPath: ({ code }) =>
      `${code} 在热路径中每轮都会重新构建，但它依赖的数据在迭代之间并没有变化：同一个集合被反复分配、遍历，开销随迭代次数成倍放大。`,
    noNPlusOneQuery: ({ api }) =>
      `热路径中逐条执行数据访问 ${api}：集合有 N 条就会产生 N 次数据库/缓存往返（N+1 查询），数据量增长后延迟与连接占用随之线性放大。`,
    noLocaleFormatInHotPath: ({ method, intl }) =>
      `热路径中带 locale/options 调用 ${method}，每次调用都会在内部新建一个 Intl 格式化器，批量处理时开销显著；请在循环/回调外创建一次 ${intl} 并复用。`,
    noLayoutThrashing: ({ read }) =>
      `同一轮循环/数组回调里既修改样式或 DOM、又读取布局信息 ${read}：每次读取都会迫使浏览器立即同步重排，n 轮就是 n 次重排（布局抖动）。`,
    noJsonStringifyComparison: () =>
      '用 JSON.stringify 的结果判断相等并不可靠：结果依赖属性顺序（内容相同、构造顺序不同会判为不等），还会丢弃 undefined 与函数、改写 NaN / Date / Map / Set，且每次比较都要完整序列化两个对象。',
    noLossyErrorSerialization: ({ name, form }) =>
      `错误对象 "${name}" 经 ${form} 处理后会丢失关键信息：Error 的 message、stack（以及 cause）都是不可枚举属性，JSON.stringify、对象展开和 Object.assign 都读不到，结果通常只剩 "{}"。`,
  },
  en: {
    noDeepRelativeImports: ({ value, maxDepth }) => `Import path "${value}" must not exceed max depth ${maxDepth}`,
    swallowedError: () => 'Caught exception is neither rethrown nor logged; potential swallowed error detected.',
    circularDependency: ({ chain }) => `Circular dependency detected: ${chain}`,
    unresolvedImport: ({ value }) =>
      `Unable to resolve import "${value}". Check tsconfig paths/baseUrl/rootDirs or package.json exports.`,
    noLayerViolations: ({ fromLayer, toLayer, value }) =>
      `Layer "${fromLayer}" must not depend on layer "${toLayer}". Check import "${value}".`,
    noCrossPackagePrivateImports: ({ value, packageName }) =>
      `Cross-package import "${value}" reaches into the private implementation of workspace package "${packageName}". Import from a public entry instead.`,
    noCatastrophicRegex: ({ pattern }) =>
      `Regex in a hot path contains nested unbounded quantifiers and may trigger catastrophic backtracking: ${pattern}`,
    noBlockingApiInHotPath: ({ api }) =>
      `Blocking API ${api} is called in a hot path and may repeatedly block the event loop.`,
    noDeepCloneInLoop: () => 'Deep cloning in a hot path (structuredClone or JSON.parse(JSON.stringify)) may be costly.',
    noN2ArrayLookup: ({ method }) =>
      `Linear lookup method ${method} is used in a hot path and may cause O(n^2) access.`,
    noAsyncForEach: () =>
      'forEach does not await async callbacks: execution continues before they finish, and errors thrown inside become unhandled promise rejections.',
    noAccumulatingSpread: ({ name }) =>
      `Spreading accumulator "${name}" in a hot path copies it on every iteration and leads to O(n^2) work.`,
    noLostErrorCause: ({ name }) =>
      `A new error is thrown inside this catch block, but the caught exception${name ? ` "${name}"` : ''} is never used, so the original stack and context are lost.`,
    noTestImportInProd: ({ value }) =>
      `Production code imports test-only module "${value}"; test fixtures, mocks or the test framework will end up in the production bundle.`,
    noSelfPackageImport: ({ value, packageName }) =>
      `"${value}" imports the module's own package "${packageName}" by name; this bypasses the source tree and resolves to the installed/built copy, causing stale code, duplicate module instances and hidden cycles.`,
    noRegexpConstructionInHotPath: ({ pattern }) =>
      `RegExp is built from the constant pattern "${pattern}" inside a hot path and recompiled on every iteration; hoist it out of the loop/callback and reuse it.`,
    noAwaitInLoop: () =>
      'Awaiting inside a loop serializes the iterations; if they are independent, run them concurrently instead.',
    noNonLiteralDynamicImport: ({ form }) =>
      `The specifier passed to ${form} is not a literal, so bundlers cannot resolve it statically: the module may be missing at runtime or an entire directory gets bundled, and dependency analysis cannot see this edge.`,
    noCollectionRebuildInHotPath: ({ code }) =>
      `${code} is rebuilt on every iteration of a hot path even though the data it depends on does not change between iterations; the same collection is allocated and traversed again and again.`,
    noNPlusOneQuery: ({ api }) =>
      `Data access ${api} runs once per item in a hot path: N items mean N database/cache round-trips (the N+1 query problem), so latency and connection usage grow linearly with the data.`,
    noLocaleFormatInHotPath: ({ method, intl }) =>
      `Calling ${method} with locales/options in a hot path creates a new Intl formatter on every call, which is costly across many items; create one ${intl} outside the loop/callback and reuse it.`,
    noLayoutThrashing: ({ read }) =>
      `Layout is read (${read}) in the same loop/callback iteration that writes styles or the DOM: every read forces a synchronous reflow, so n iterations mean n reflows (layout thrashing).`,
    noJsonStringifyComparison: () =>
      'Comparing JSON.stringify results is not a reliable equality check: the output depends on property order (equal objects built in a different order compare unequal), drops undefined and functions, coerces NaN / Date / Map / Set, and serializes both values on every comparison.',
    noLossyErrorSerialization: ({ name, form }) =>
      `Error "${name}" loses its key information through ${form}: message, stack (and cause) are non-enumerable, so JSON.stringify, object spread and Object.assign skip them and usually produce just "{}".`,
  },
}

// 固定文案对象，避免运行期被意外修改。
Object.values(ruleTranslations).forEach((messages) => Object.freeze(messages))

// 根据语言返回对应的规则文案实现。
export const createRuleMessages = (language: Language): RuleMessages => {
  return ruleTranslations[language] ?? ruleTranslations.zh
}
