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

const parseNumericParts = (version) => {
  const [major, minor, patchWithMeta = '0'] = version.split('.')
  const patchMatch = patchWithMeta.match(/^(\d+)/)
  const majorNum = Number(major)
  const minorNum = Number(minor)
  const patchNum = Number(patchMatch?.[1] ?? patchWithMeta)

  if ([majorNum, minorNum, patchNum].some((value) => Number.isNaN(value))) {
    throw new Error(`Invalid semver encountered: ${version}`)
  }

  return [majorNum, minorNum, patchNum]
}

const compareVersions = (a, b) => {
  const [aMajor, aMinor, aPatch] = parseNumericParts(a)
  const [bMajor, bMinor, bPatch] = parseNumericParts(b)

  if (aMajor !== bMajor) return aMajor > bMajor ? 1 : -1
  if (aMinor !== bMinor) return aMinor > bMinor ? 1 : -1
  if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1
  return 0
}

const extractTagVersion = () => {
  const raw = process.env.TAG_VERSION || process.env.GITHUB_REF_NAME || process.env.GITHUB_REF
  if (!raw) return null

  const normalized = raw.replace(/^refs\/tags\//, '')
  const match = normalized.match(/^v(\d+\.\d+\.\d+(?:[-+].*)?)$/)
  return match ? match[1] : null
}

const decideNextVersion = (current) => {
  const tagVersion = extractTagVersion()

  if (tagVersion) {
    const comparison = compareVersions(tagVersion, current)

    if (comparison >= 0) {
      if (comparison > 0) {
        console.log(`Using tag version ${tagVersion} (was ${current})`)
      } else {
        console.log(`Tag version ${tagVersion} matches current version; keeping as-is`)
      }

      return tagVersion
    }

    console.warn(
      `Tag version ${tagVersion} is lower than package version ${current}; falling back to ${VERSION_TYPE} bump`
    )
  }

  const bumped = semverBump(current)
  console.log(`Proceeding with ${VERSION_TYPE} bump: ${current} -> ${bumped}`)
  return bumped
}

const updatePackage = (packageName, nextVersion) => {
  const packagePath = join(WORKSPACE_ROOT, 'packages', packageName, 'package.json')
  const content = JSON.parse(readFileSync(packagePath, 'utf-8'))
  content.version = nextVersion

  // 发布脚本改为只更新包自身 version，不再改写 auto-cr-cmd 里的 auto-cr-rules 依赖版本
  // if (packageName === 'auto-cr-cmd' && content.dependencies?.['auto-cr-rules']) {
  //   content.dependencies['auto-cr-rules'] = `^${nextVersion}`
  // }

  writeFileSync(packagePath, `${JSON.stringify(content, null, 2)}\n`)
  return packagePath
}

const main = () => {
  const current = JSON.parse(
    readFileSync(join(WORKSPACE_ROOT, 'packages', PACKAGES[0], 'package.json'), 'utf-8')
  ).version

  const nextVersion = decideNextVersion(current)
  PACKAGES.forEach((name) => updatePackage(name, nextVersion))
  console.log(`Version updated to ${nextVersion}`)
}

main()
