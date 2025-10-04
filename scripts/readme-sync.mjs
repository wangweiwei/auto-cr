#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WORKSPACE_ROOT = resolve(__dirname, '..')
const README_FILES = ['README.md', 'README.zh-CN.md']
const TARGET_PACKAGES = ['auto-cr-cmd', 'auto-cr-rules']

function usage() {
  console.error('Usage: node scripts/readme-sync.mjs <copy|clean|delayed-clean> [package-name|all]')
  process.exit(1)
}

const [action, target = 'all'] = process.argv.slice(2)

if (!action || !['copy', 'clean', 'delayed-clean'].includes(action)) {
  usage()
}

const packages = target === 'all' ? TARGET_PACKAGES : [target]

function copyReadmes(pkg) {
  if (!TARGET_PACKAGES.includes(pkg)) {
    console.warn(`[readme-sync] Skip unknown package: ${pkg}`)
    return
  }

  const packageDir = join(WORKSPACE_ROOT, 'packages', pkg)
  mkdirSync(packageDir, { recursive: true })

  for (const filename of README_FILES) {
    const source = join(WORKSPACE_ROOT, filename)
    const destination = join(packageDir, filename)

    if (!existsSync(source)) {
      console.warn(`[readme-sync] Root file not found: ${filename}; skip copying for ${pkg}`)
      continue
    }

    copyFileSync(source, destination)
    console.log(`[readme-sync] Copied ${filename} to ${pkg}`)
  }
}

function cleanReadmes(pkg) {
  if (!TARGET_PACKAGES.includes(pkg)) {
    return
  }

  for (const filename of README_FILES) {
    const destination = join(WORKSPACE_ROOT, 'packages', pkg, filename)
    if (existsSync(destination)) {
      rmSync(destination)
      console.log(`[readme-sync] Removed ${filename} from ${pkg}`)
    }
  }
}

async function main() {
  if (action === 'copy') {
    packages.forEach(copyReadmes)
    return
  }

  if (action === 'clean') {
    packages.forEach(cleanReadmes)
    return
  }

  if (action === 'delayed-clean') {
    const delayMs = 500
    console.log(`[readme-sync] Scheduled README cleanup in ${delayMs} ms`)
    await new Promise((resolveCleanup) => {
      setTimeout(() => {
        packages.forEach(cleanReadmes)
        resolveCleanup()
      }, delayMs)
    })
  }
}

main().catch((error) => {
  console.error('[readme-sync] Unexpected error:', error)
  process.exit(1)
})
