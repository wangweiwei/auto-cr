import { RuleSeverity, defineRule } from '../types'
import {
  asMember,
  collectPatternNames,
  findConsumer,
  getCalledMethodName,
  getPropertyName,
  getRootName,
  isWriteTarget,
  stripWrappers,
  walkAst,
  type CallNode,
  type MemberNode,
  type TypedNode,
} from './utils/ast'
import { collectHotScopes, walkScopeIteration } from './utils/hotScopes'

// 检测循环 / 数组回调里交替读写布局（layout thrashing）：
//   for (const el of items) { el.style.height = `${el.scrollHeight}px` }
// 写入样式或 DOM 会让布局失效；之后再读取 offsetHeight、getBoundingClientRect() 等布局信息，
// 浏览器只能立刻同步重排（forced synchronous layout）。放在循环里，每一轮都要重排一次，n 个元素就是 n 次重排。
// 一轮迭代可能执行的代码（含嵌套循环与数组回调）里同时出现布局读取与样式/DOM 写入时上报，定位到第一处读取。
// 只读或只写的循环不受影响：先批量读取、再批量写入正是推荐的修复方式。
// 写入本轮新建的节点（createElement / cloneNode）或 DocumentFragment 不会让文档布局失效，不算写入。
export const noLayoutThrashing = defineRule(
  'no-layout-thrashing',
  { tag: 'performance', severity: RuleSeverity.Optimizing },
  ({ analysis, ast, helpers, language, messages }) => {
    const scopes = collectHotScopes(analysis)
    if (scopes.length === 0) {
      return
    }

    const scopeNodes = new Set<unknown>(scopes.map((scope) => scope.node))
    const reported = new Set<unknown>()
    let fragments: Set<string> | null = null
    const getFragments = (): Set<string> => {
      fragments ??= collectDetachedNames(ast, FRAGMENT_CREATORS)
      return fragments
    }
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
      // 在回调里赋值，TS 的控制流收窄看不到，用断言声明初始类型。
      let read = null as LayoutRead | null
      const writeRoots: Array<string | null> = []
      const detached = new Set<string>()

      walkScopeIteration(scope, scopeNodes, (node, ancestors) => {
        if (!read) {
          const name = describeLayoutRead(node, ancestors)
          read = name ? { node, name } : null
        }
        collectDetachedDeclaration(node, detached)
        const write = getLayoutWriteTarget(node)
        if (write !== undefined) {
          writeRoots.push(write)
        }
        return true
      })

      const hasWrite = writeRoots.some(
        (root) => !root || (!detached.has(root) && !getFragments().has(root))
      )
      if (!read || !hasWrite || reported.has(read.node)) {
        continue
      }
      reported.add(read.node)
      helpers.reportViolation(
        {
          description: messages.noLayoutThrashing({ read: read.name }),
          code: read.name,
          suggestions,
          span: read.node.span,
        },
        read.node.span
      )
    }
  }
)

type LayoutRead = { node: TypedNode; name: string }

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

// 滚动偏移：赋值同样会先强制同步布局（它只改滚动位置、不让布局失效），因此读取与赋值都按“读取”处理。
const SCROLL_OFFSET_PROPERTIES = new Set(['scrollTop', 'scrollLeft'])

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

// 新建的、尚未挂到文档上的节点：写入它们不会让文档布局失效。
const DETACHED_CREATORS = new Set([
  'createElement',
  'createElementNS',
  'createTextNode',
  'createDocumentFragment',
  'cloneNode',
  'importNode',
])
const FRAGMENT_CREATORS = new Set(['createDocumentFragment'])

// 布局读取：el.offsetHeight（不是赋值 / delete 的目标；scrollTop / scrollLeft 的赋值除外）、el.getBoundingClientRect()、getComputedStyle(el)。
const describeLayoutRead = (
  node: TypedNode,
  ancestors: ReadonlyArray<TypedNode>
): string | null => {
  if (node.type === 'MemberExpression') {
    const name = getPropertyName(node as MemberNode)
    if (!name || !LAYOUT_PROPERTIES.has(name)) {
      return null
    }
    const { child, parent } = findConsumer(node, ancestors)
    if (!isWriteTarget(child, parent)) {
      return `.${name}`
    }
    return SCROLL_OFFSET_PROPERTIES.has(name) && parent?.type !== 'UnaryExpression'
      ? `.${name} =`
      : null
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

// 接收者自身的名字：a[i].classList → 'classList'，裸标识符 style → 'style'。
const getOwnName = (node: unknown): string | null => {
  const member = asMember(node)
  if (member) {
    return getPropertyName(member)
  }
  const stripped = stripWrappers(node) as (TypedNode & { value?: string }) | null
  return stripped?.type === 'Identifier' ? (stripped.value ?? null) : null
}

// 布局写入：style 赋值 / setProperty、classList 变更、className / innerHTML 等赋值、DOM 结构变更。
// 是写入时返回被写对象的根名（取不到时为 null），不是写入时返回 undefined。
const getLayoutWriteTarget = (node: TypedNode): string | null | undefined => {
  if (node.type === 'AssignmentExpression') {
    const member = asMember((node as TypedNode & { left?: unknown }).left)
    const name = member ? getPropertyName(member) : null
    if (
      !member ||
      !(
        name === 'style' ||
        getOwnName(member.object) === 'style' ||
        (name && WRITE_PROPERTIES.has(name))
      )
    ) {
      return undefined
    }
    return getRootName(member)
  }
  if (node.type === 'CallExpression') {
    const call = node as CallNode
    const method = getCalledMethodName(call)
    const receiver = asMember(call.callee)?.object
    const receiverName = getOwnName(receiver)
    const isWrite =
      (method && WRITE_METHODS.has(method)) ||
      (receiverName === 'classList' && CLASS_LIST_METHODS.has(method ?? '')) ||
      (receiverName === 'style' && STYLE_METHODS.has(method ?? ''))
    return isWrite ? getRootName(receiver) : undefined
  }
  return undefined
}

const isDetachedInit = (init: unknown, creators: ReadonlySet<string>): boolean => {
  const call = stripWrappers(init)
  return (
    call?.type === 'CallExpression' && creators.has(getCalledMethodName(call as CallNode) ?? '')
  )
}

// const div = document.createElement('div')：本轮新建的节点。
const collectDetachedDeclaration = (node: TypedNode, out: Set<string>): void => {
  const declarator = node as TypedNode & { id?: unknown; init?: unknown }
  if (node.type === 'VariableDeclarator' && isDetachedInit(declarator.init, DETACHED_CREATORS)) {
    collectPatternNames(declarator.id, out)
  }
}

// 文件内由 createDocumentFragment() 初始化的变量：往 fragment 里写入不会触发文档重排。
const collectDetachedNames = (ast: unknown, creators: ReadonlySet<string>): Set<string> => {
  const names = new Set<string>()
  walkAst(ast, (node) => {
    const declarator = node as TypedNode & { id?: unknown; init?: unknown }
    if (node.type === 'VariableDeclarator' && isDetachedInit(declarator.init, creators)) {
      collectPatternNames(declarator.id, names)
    }
    return true
  })
  return names
}
