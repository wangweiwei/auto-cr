# no-layout-thrashing / 禁止在循环中交替读写布局（布局抖动）

## 1. 目的
- 修改样式或 DOM 会让浏览器的布局失效；紧接着读取 `offsetHeight`、`getBoundingClientRect()` 等布局信息时，浏览器只能立刻同步重排（forced synchronous layout）。
- 放在循环里，读和写交替出现：`for (const el of items) { el.style.height = `${el.scrollHeight}px` }` 中，第 i 轮的读取要为第 i-1 轮的写入付出一次完整重排，n 个元素就是 n 次重排，页面越复杂越慢，典型表现是列表/表格初始化卡顿、动画掉帧。
- 修复方式很机械：先批量读取，再批量写入。ESLint 生态中只有针对“同一轮里至少两次 `style` 赋值”的规则（react-doctor 的 `js-batch-dom-css`），覆盖不到最常见的“每轮读一次、写一次”。

## 2. 适用范围
- 浏览器端 JavaScript / TypeScript 源码中的热路径：循环体（`for` / `for...of` / `for...in` / `while` / `do...while`）与数组高阶方法回调（`forEach` / `map` 等）。一轮迭代内的嵌套循环、嵌套回调一并计入；循环内定义的事件处理函数等普通函数不计入。
- 布局读取：`offsetWidth/Height/Top/Left/Parent`、`clientWidth/Height/Top/Left`、`scrollWidth/Height/Top/Left`、`innerText` 的读取，`scrollTop` / `scrollLeft` 的赋值（赋值前浏览器同样要先完成布局，但它只改滚动位置、不让布局失效，因此按“读取”处理），以及 `getBoundingClientRect()`、`getClientRects()`、`getComputedStyle()`、`getBBox()` 调用。
- 布局写入：`xxx.style.* =` 与 `style.setProperty/removeProperty()`、`classList.add/remove/toggle/replace()`（含 `items[i].classList`）、`className` / `innerHTML` / `outerHTML` / `textContent` / `innerText` 赋值，以及 `appendChild`、`insertBefore`、`removeChild`、`replaceChild`、`insertAdjacentHTML/Element/Text`、`replaceChildren`、`replaceWith`、`setAttribute`、`removeAttribute`、`toggleAttribute` 调用。
- 写入尚未挂到文档上的节点不算布局写入：本轮用 `createElement` / `createElementNS` / `createTextNode` / `cloneNode` / `importNode` 新建的节点，以及文件内由 `createDocumentFragment()` 初始化的变量。

## 3. 规则说明
- 约束：同一轮迭代内不得既写入样式/DOM、又读取布局信息。
- 判定方式：
  - 复用共享分析的循环与回调索引，逐个作用域收集一轮迭代内的布局读取与布局写入。
  - 两者都存在时上报，定位到该作用域内的第一处布局读取；每个作用域只报一次。
  - 只读或只写的循环不报：先在一个循环里批量读取、再在另一个循环里批量写入正是推荐的修复方式。
- 严重程度：optimizing（默认 tag：`performance`）。
- 可配置项：当前版本无可配置参数；可通过配置文件关闭或调整严重级别。

## 4. 示例
### 4.1 违规示例
```ts
for (const item of items) {
  item.style.height = `${item.scrollHeight}px`             // 每一轮都触发一次同步重排
}

items.forEach((item) => {
  if (item.getBoundingClientRect().width > panel.clientWidth) {
    item.classList.add('overflowing')
  }
})
```
### 4.2 合规示例
```ts
const heights = items.map((item) => item.scrollHeight)   // 先批量读
items.forEach((item, index) => {
  item.style.height = `${heights[index]}px`               // 再批量写
})

for (const item of items) {
  total += item.offsetHeight                              // 只读，不报
}
```

## 5. 例外/豁免
- 规则按属性名/方法名识别，不校验对象是否真的是 DOM 元素；普通对象上同名的 `scrollTop`、`clientWidth` 等属性也会参与判断。
- 部分算法天然需要逐步读写（例如逐行测量的虚拟列表）。确认无法拆分时，可在该处关闭本规则，或用 `requestAnimationFrame` / fastdom 之类的读写调度库改写。只改 `scrollTop` / `scrollLeft` 的逐级滚动（scrollIntoView 的常见实现）不会触发本规则。
- 规则不分析控制流：读取与写入位于互斥的分支（`if (measure) { read } else { write }`），或写入之后紧跟 `break` / `return` 时，实际不会交替执行，但仍会上报；可在该处关闭本规则。
- `append` / `prepend` / `remove` 等通用方法名（`FormData`、`URLSearchParams` 也有）不计为布局写入，因此这类写入不会触发本规则。

## 6. 与工具的映射
- 规则 ID：`no-layout-thrashing`
- 规则实现：`packages/auto-cr-rules/src/rules/noLayoutThrashing.ts`
- 启用方式：`auto-cr-cmd` 默认加载内置规则集并启用本规则；可在 `.autocrrc.json` 的 `rules` 中设为 `"off"` 或调整严重级别。

## 7. 版本与变更
- 当前规则版本参考包版本：`auto-cr-rules@2.0.124`
- 变更记录：
  - 2.0.124：新增规则，检测循环中交替读写布局。

## 8. 参考资料
- web.dev：Avoid large, complex layouts and layout thrashing：https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing
- Paul Irish：What forces layout / reflow：https://gist.github.com/paulirish/5d52fb081b3570c81e3a
