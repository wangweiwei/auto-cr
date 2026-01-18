#!/usr/bin/env node
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const gitDir = path.join(root, '.git')

if (!fs.existsSync(gitDir)) {
  process.exit(0)
}

try {
  execSync('git config core.hooksPath .githooks', { stdio: 'ignore' })
} catch {
  // Ignore errors to avoid breaking installs in environments without git.
}
