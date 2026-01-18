#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd()
const lockfilePath = path.join(root, 'pnpm-lock.yaml')

if (!fs.existsSync(lockfilePath)) {
  console.error('pnpm-lock.yaml not found. Please generate the lockfile before pushing.')
  process.exit(1)
}

const lockfile = fs.readFileSync(lockfilePath, 'utf8')
const lockSpecifiers = parseLockfileSpecifiers(lockfile)
const packageJsonPaths = collectPackageJsonPaths(root)

const mismatches = []

for (const pkgPath of packageJsonPaths) {
  const pkgDir = path.dirname(pkgPath)
  const importerKey = pkgDir === root ? '.' : toPosix(path.relative(root, pkgDir))
  const manifest = readJson(pkgPath)
  const manifestSpecifiers = collectManifestSpecifiers(manifest)
  const lockImporter = lockSpecifiers.get(importerKey)

  for (const [name, manifestSpec] of Object.entries(manifestSpecifiers)) {
    const lockSpec = lockImporter?.get(name)
    if (!lockSpec) {
      mismatches.push({ importerKey, name, lockSpec: '(missing)', manifestSpec })
      continue
    }

    if (lockSpec !== manifestSpec) {
      mismatches.push({ importerKey, name, lockSpec, manifestSpec })
    }
  }
}

if (mismatches.length > 0) {
  console.error('Lockfile specifiers do not match package.json:')
  for (const mismatch of mismatches) {
    console.error(
      `- ${mismatch.importerKey}: ${mismatch.name} (lockfile: ${mismatch.lockSpec}, manifest: ${mismatch.manifestSpec})`
    )
  }
  console.error('Run "pnpm install --no-frozen-lockfile" to update pnpm-lock.yaml before pushing.')
  process.exit(1)
}

function collectPackageJsonPaths(rootDir) {
  const result = [path.join(rootDir, 'package.json')]
  const packagesDir = path.join(rootDir, 'packages')

  if (!fs.existsSync(packagesDir)) {
    return result.filter((entry) => fs.existsSync(entry))
  }

  const entries = fs.readdirSync(packagesDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    const pkgPath = path.join(packagesDir, entry.name, 'package.json')
    if (fs.existsSync(pkgPath)) {
      result.push(pkgPath)
    }
  }

  return result.filter((entry) => fs.existsSync(entry))
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  return JSON.parse(raw)
}

function collectManifestSpecifiers(manifest) {
  return {
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
    ...(manifest.peerDependencies ?? {}),
  }
}

function parseLockfileSpecifiers(lockfile) {
  const specifiers = new Map()
  const lines = lockfile.split(/\r?\n/)
  let inImporters = false
  let currentImporter = null
  let currentSection = null
  let currentDependency = null

  for (const line of lines) {
    if (!inImporters) {
      if (line.startsWith('importers:')) {
        inImporters = true
      }
      continue
    }

    if (line && !line.startsWith(' ')) {
      break
    }

    const importerMatch = line.match(/^  ([^ ].*):\s*$/)
    if (importerMatch) {
      currentImporter = importerMatch[1]
      currentSection = null
      currentDependency = null
      if (!specifiers.has(currentImporter)) {
        specifiers.set(currentImporter, new Map())
      }
      continue
    }

    if (!currentImporter) {
      continue
    }

    const sectionMatch = line.match(/^    (dependencies|devDependencies|optionalDependencies|peerDependencies):\s*$/)
    if (sectionMatch) {
      currentSection = sectionMatch[1]
      currentDependency = null
      continue
    }

    if (/^    \S/.test(line)) {
      currentSection = null
      currentDependency = null
      continue
    }

    if (!currentSection) {
      continue
    }

    const dependencyMatch = line.match(/^      (.+?):\s*$/)
    if (dependencyMatch) {
      currentDependency = normalizeKey(dependencyMatch[1])
      continue
    }

    if (!currentDependency) {
      continue
    }

    const specifierMatch = line.match(/^        specifier:\s*(.+)\s*$/)
    if (!specifierMatch) {
      continue
    }

    const value = normalizeSpecifier(specifierMatch[1])
    specifiers.get(currentImporter).set(currentDependency, value)
  }

  return specifiers
}

function normalizeSpecifier(raw) {
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function normalizeKey(raw) {
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function toPosix(value) {
  return value.replace(/\\/g, '/')
}
