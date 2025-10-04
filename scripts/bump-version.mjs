#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const WORKSPACE_ROOT = process.cwd()
const PACKAGES = ['auto-cr-rules', 'auto-cr-cmd']
const VERSION_TYPE = process.env.VERSION_TYPE || process.argv[2] || 'patch'

const semverBump = (version) => {
  const [major, minor, patchWithMeta = '0'] = version.split('.')
  const patchMatch = patchWithMeta.match(/^(\d+)(.*)$/)
  const patch = Number(patchMatch?.[1] ?? patchWithMeta)
  const suffix = patchMatch?.[2] ?? ''

  switch (VERSION_TYPE) {
    case 'major':
      return `${Number(major) + 1}.0.0`
    case 'minor':
      return `${major}.${Number(minor) + 1}.0`
    case 'patch':
    default:
      return `${major}.${minor}.${patch + 1}${suffix}`
  }
}

const updatePackage = (packageName, nextVersion) => {
  const packagePath = join(WORKSPACE_ROOT, 'packages', packageName, 'package.json')
  const content = JSON.parse(readFileSync(packagePath, 'utf-8'))
  content.version = nextVersion
  writeFileSync(packagePath, `${JSON.stringify(content, null, 2)}\n`)
  return packagePath
}

const main = () => {
  const current = JSON.parse(
    readFileSync(join(WORKSPACE_ROOT, 'packages', PACKAGES[0], 'package.json'), 'utf-8')
  ).version

  const nextVersion = semverBump(current)

  PACKAGES.forEach((name) => updatePackage(name, nextVersion))

  console.log(`Version bumped to ${nextVersion}`)
}

main()
