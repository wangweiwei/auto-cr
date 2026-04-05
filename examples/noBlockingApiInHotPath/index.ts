import fs from 'fs'
import { readFileSync } from 'fs'
import { execSync } from 'child_process'
import { pbkdf2Sync } from 'crypto'

const files = ['a.json', 'b.json']
const config = fs.readFileSync('./config.json', 'utf8')

console.log(config.length)

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8')
  console.log(content.length)
}

files.forEach((file) => {
  readFileSync(file, 'utf8')
})

files.forEach((file) => {
  execSync(`wc -l ${file}`)
})

const { execSync: requireExecSync } = require('child_process')
files.forEach((file) => {
  requireExecSync(`wc -l ${file}`)
})

const fsSync = fs
files.map((value) => {
  fsSync.statSync(value)
  return pbkdf2Sync(value, 'salt', 1000, 16, 'sha256')
})

function ok(readFileSync: (value: string) => string, execSync: (value: string) => string) {
  files.forEach((file) => {
    readFileSync(file)
    execSync(file)
  })
}

ok(
  (value) => value,
  (value) => value
)
