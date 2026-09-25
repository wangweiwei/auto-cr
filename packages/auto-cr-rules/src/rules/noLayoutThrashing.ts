import type { Span } from '@swc/types'
import { RuleSeverity, defineRule } from '../types'
import {
  asMember,
  getCalledMethodName,
  getNameChain,
  getPropertyName,
  isTransparentWrapper,
  stripWrappers,
  type CallNode,
  type MemberNode,
  type TypedNode,
} from './utils/ast'
import { collectHotScopes, walkScopeIteration } from './utils/hotScopes'

// 检测循环 / 数组回调里交替读写布局（layout thrashing）：
//   for (const el of items) { el.style.height = `${el.scrollHeight}px` }
// 写入样式或 DOM 会让布局失效；之后再读取 offsetHeight、getBoundingClientRect() 等布局信息，
// 浏览器只能立刻同步重排（forced synchronous layout）。放在循环里，每一轮都要重排一次，n 个元素就是 n 次重排。
// 同一轮迭代（含嵌套循环与数组回调）里既有布局读取、又有样式/DOM 写入时上报，定位到第一处读取。
// 只读或只写的循环不受影响：先批量读取、再批量写入正是推荐的修复方式。
export const noLayoutThrashing = defineRule(
  'no-layout-thrashing',
  { tag: 'performance', severity: RuleSeverity.Optimizing },
  ({ analysis, helpers, language, messages }) => {
    const scopes = collectHotScopes(analysis)
    if (scopes.length === 0) {
      return
    }

    const scopeNodes = new Set<unknown>(scopes.map((scope) => scope.node))
    const reported = new Set<unknown>()
    const suggestions =
      language === 'zh'
        ? [
            {
              text: '拆成两个循环：先在一个循环里读完所有测量值，再在另一个循环里统一写入样式/DOM。',
            },
            {
              text: '写入放进 requestAnimationFrame，或使用 fastdom 之类的读写调度；能用 CSS（flex、grid、transform）解决的尽量不要逐个测量。',
            },
          ]
        : [
            {
              text: 'Split the work into two loops: read all measurements first, then apply all style/DOM writes.',
            },
            {
              text: 'Defer writes with requestAnimationFrame or a read/write scheduler such as fastdom; prefer CSS (flex, grid, transform) over per-element measuring.',
            },
          ]

    for (const scope of scopes) {
      let firstRead: { node: TypedNode; name: string } | null = null
      let hasWrite = false

      walkScopeIteration(scope, scopeNodes, (node, ancestors) => {
        const read = describeLayoutRead(node, ancestors)
        if (read && !firstRead) {
          firstRead = { node, name: read }
        }
        if (!hasWrite && isLayoutWrite(node)) {
          hasWrite = true
        }
        return true
      })

      const read = firstRead as { node: TypedNode; name: string } | null
      if (!read || !hasWrite || reported.has(read.node)) {
        continue
      }
      reported.add(read.node)
      const span = (read.node as { span?: Span }).span
      helpers.reportViolation(
        {
          description: messages.noLayoutThrashing({ read: read.name }),
          code: read.name,
          suggestions,
          span,
        },
        span
      )
    }
  }
)

// 读取即触发同步布局的属性。
const LAYOUT_PROPERTIES = new Set([
  'offsetWidth',
  'offsetHeight',
  'offsetTop',
  'offsetLeft',
  'offsetParent',
  'clientWidth',
  'clientHeight',
  'clientTop',
  'clientLeft',
  'scrollWidth',
  'scrollHeight',
  'scrollTop',
  'scrollLeft',
  'innerText',
])

// 调用即触发同步布局的方法。
const LAYOUT_METHODS = new Set([
  'getBoundingClientRect',
  'getClientRects',
  'getComputedStyle',
  'getBBox',
])

// 赋值即让布局失效的属性（style 另行处理）。
const WRITE_PROPERTIES = new Set([
  'className',
  'innerHTML',
  'outerHTML',
  'textContent',
  'innerText',
  'scrollTop',
  'scrollLeft',
])

// 调用即修改 DOM 结构或属性的方法；append / remove 这类通用名字（FormData、URLSearchParams 也有）不计入。
const WRITE_METHODS = new Set([
  'appendChild',
  'insertBefore',
  'removeChild',
  'replaceChild',
  'insertAdjacentHTML',
  'insertAdjacentElement',
  'insertAdjacentText',
  'replaceChildren',
  'replaceWith',
  'setAttribute',
  'removeAttribute',
  'toggleAttribute',
])

const CLASS_LIST_METHODS = new Set(['add', 'remove', 'toggle', 'replace'])
const STYLE_METHODS = new Set(['setProperty', 'removeProperty'])

// 布局读取：el.offsetHeight（不是赋值目标）、el.getBoundingClientRect()、getComputedStyle(el)。
const describeLayoutRead = (
  node: TypedNode,
  ancestors: ReadonlyArray<TypedNode>
): string | null => {
  if (node.type === 'MemberExpression') {
    const name = getPropertyName(node as MemberNode)
    if (!name || !LAYOUT_PROPERTIES.has(name) || isAssignmentTarget(node, ancestors)) {
      return null
    }
    return `.${name}`
  }
  if (node.type === 'CallExpression') {
    const call = node as CallNode
    const callee = stripWrappers(call.callee) as (TypedNode & { value?: string }) | null
    if (callee?.type === 'Identifier' && callee.value === 'getComputedStyle') {
      return 'getComputedStyle()'
    }
    const method = getCalledMethodName(call)
    return method && LAYOUT_METHODS.has(method) ? `.${method}()` : null
  }
  return null
}

// 布局写入：style 赋值 / setProperty、classList 变更、className / innerHTML 等赋值、DOM 结构变更。
const isLayoutWrite = (node: TypedNode): boolean => {
  if (node.type === 'AssignmentExpression') {
    const member = asMember((node as TypedNode & { left?: unknown }).left)
    if (!member) {
      return false
    }
    const name = getPropertyName(member)
    return (
      name === 'style' ||
      isStyleObject(member.object) ||
      Boolean(name && WRITE_PROPERTIES.has(name))
    )
  }
  if (node.type === 'CallExpression') {
    const call = node as CallNode
    const method = getCalledMethodName(call)
    if (!method) {
      return false
    }
    if (WRITE_METHODS.has(method)) {
      return true
    }
    const receiver = asMember(call.callee)?.object
    const receiverChain = getNameChain(receiver)
    const receiverName = receiverChain?.[receiverChain.length - 1]
    if (receiverName === 'classList') {
      return CLASS_LIST_METHODS.has(method)
    }
    return receiverName === 'style' && STYLE_METHODS.has(method)
  }
  return false
}

// el.style.width = ... / el.style[prop] = ...：被赋值成员的对象本身是 xxx.style。
const isStyleObject = (object: unknown): boolean => {
  const member = asMember(object)
  return Boolean(member && getPropertyName(member) === 'style')
}

const isAssignmentTarget = (node: TypedNode, ancestors: ReadonlyArray<TypedNode>): boolean => {
  let child: TypedNode = node
  let index = ancestors.length - 1
  while (index >= 0 && isTransparentWrapper(ancestors[index])) {
    child = ancestors[index]
    index -= 1
  }
  const parent = ancestors[index] as
    | (TypedNode & { left?: unknown; argument?: unknown })
    | undefined
  if (parent?.type === 'AssignmentExpression') {
    return parent.left === child
  }
  return parent?.type === 'UpdateExpression' && parent.argument === child
}
