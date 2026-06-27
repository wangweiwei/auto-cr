import path from 'path'
import { resolveLineFromByteOffset } from '../sourceIndex'
import { RuleSeverity, defineRule } from '../types'
import { resolveRelativeImport, resolveWorkspaceRoot } from './utils/workspace'

type LayerConfig = {
  name: string
  paths: string[]
  imports?: string[]
  allow?: string[]
}

type LayerRuleOptions = {
  layers: LayerConfig[]
}

type MatchedLayer = {
  layer: LayerConfig
  score: number
}

// 检测分层架构中的依赖方向违规。
// 规则通过 .autocrrc 的 ruleOptions 配置层定义与允许依赖关系。
export const noLayerViolations = defineRule(
  'no-layer-violations',
  { tag: 'architecture', severity: RuleSeverity.Warning, enabledByDefault: false },
  ({ configDir, filePath, helpers, language, messages, options, source, sourceIndex }) => {
    const parsed = parseLayerRuleOptions(options)
    if (!parsed || parsed.layers.length === 0) {
      return
    }

    const root = path.resolve(configDir ?? resolveWorkspaceRoot(filePath))
    const origin = path.resolve(filePath)
    const relativeFilePath = normalizePath(path.relative(root, origin))
    const currentLayer = matchLayerByPath(relativeFilePath, parsed.layers)

    if (!currentLayer) {
      return
    }

    const allowedLayers = new Set(currentLayer.allow ?? [])
    const suggestions =
      language === 'zh'
        ? [
            { text: '将共享逻辑下沉到更底层的 shared 层，避免反向依赖。' },
            { text: '或调整模块边界，通过上层编排而不是跨层直接引用。' },
          ]
        : [
            { text: 'Move shared logic down to a lower layer such as shared to avoid reverse dependencies.' },
            { text: 'Or reshape module boundaries so upper layers orchestrate instead of lower layers importing upward.' },
          ]

    for (const reference of helpers.imports) {
      const cleaned = reference.value.split(/[?#]/)[0]
      const targetLayer = resolveTargetLayer(cleaned, origin, root, parsed.layers)
      if (!targetLayer || targetLayer.name === currentLayer.name || allowedLayers.has(targetLayer.name)) {
        continue
      }

      const line = reference.span ? resolveLineFromByteOffset(source, sourceIndex, reference.span.start) : undefined

      helpers.reportViolation(
        {
          description: messages.noLayerViolations({
            fromLayer: currentLayer.name,
            toLayer: targetLayer.name,
            value: reference.value,
          }),
          code: reference.value,
          suggestions,
          line,
          span: reference.span,
        },
        reference.span
      )
    }
  }
)

const resolveTargetLayer = (specifier: string, origin: string, root: string, layers: LayerConfig[]): LayerConfig | null => {
  if (specifier.startsWith('.')) {
    const resolved = resolveRelativeImport(origin, specifier, root)
    if (!resolved) {
      return null
    }

    const relativeTargetPath = normalizePath(path.relative(root, resolved))
    return matchLayerByPath(relativeTargetPath, layers)
  }

  return matchLayerByImport(specifier, layers)
}

const matchLayerByPath = (relativePath: string, layers: LayerConfig[]): LayerConfig | null => {
  const matched = findBestLayer(layers, (layer) => layer.paths, relativePath)
  return matched?.layer ?? null
}

const matchLayerByImport = (specifier: string, layers: LayerConfig[]): LayerConfig | null => {
  const matched = findBestLayer(layers, (layer) => layer.imports ?? [], normalizePath(specifier))
  return matched?.layer ?? null
}

const findBestLayer = (
  layers: LayerConfig[],
  getPatterns: (layer: LayerConfig) => string[],
  value: string
): MatchedLayer | null => {
  let bestMatch: MatchedLayer | null = null

  for (const layer of layers) {
    for (const pattern of getPatterns(layer)) {
      const normalizedPattern = normalizePattern(pattern)
      if (!matchesGlob(normalizedPattern, value)) {
        continue
      }

      const score = normalizedPattern.length
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { layer, score }
      }
    }
  }

  return bestMatch
}

const parseLayerRuleOptions = (options: unknown): LayerRuleOptions | null => {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return null
  }

  const rawLayers = (options as { layers?: unknown }).layers
  if (!Array.isArray(rawLayers)) {
    return null
  }

  const layers: LayerConfig[] = []

  for (const entry of rawLayers) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue
    }

    const candidate = entry as {
      name?: unknown
      paths?: unknown
      imports?: unknown
      allow?: unknown
    }

    if (typeof candidate.name !== 'string') {
      continue
    }

    const paths = normalizeStringArray(candidate.paths)
    if (paths.length === 0) {
      continue
    }

    const imports = normalizeStringArray(candidate.imports)
    const allow = normalizeStringArray(candidate.allow)
    layers.push({
      name: candidate.name,
      paths,
      imports: imports.length > 0 ? imports : undefined,
      allow: allow.length > 0 ? allow : undefined,
    })
  }

  return layers.length > 0 ? { layers } : null
}

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

const normalizePath = (value: string): string => value.replace(/\\/g, '/')

const normalizePattern = (pattern: string): string => normalizePath(pattern).replace(/^\.\//, '')

const matchesGlob = (pattern: string, value: string): boolean => {
  const normalizedValue = value.replace(/^\.\//, '')
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
  const withDoubleStar = escaped.replace(/\*\*/g, '::DOUBLE_STAR::')
  const withSingleStar = withDoubleStar.replace(/\*/g, '[^/]*')
  const regex = new RegExp(`^${withSingleStar.replace(/::DOUBLE_STAR::/g, '.*')}$`)
  return regex.test(normalizedValue)
}
