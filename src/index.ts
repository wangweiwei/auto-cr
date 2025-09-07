#!/usr/bin/env node
import { consola } from 'consola'
import { program } from 'commander'
import { run } from './run';

program
  .argument('[paths...]', '需要扫描的文件或目录路径列表')
  .option('-r, --rule-dir <directory>', '自定义规则目录路径')
  .parse(process.argv)

const options = program.opts()
const filePaths = program.args

;(async () => {
  try {
    await run(filePaths, options.ruleDir)
    process.exit(0)
  } catch (error) {
    consola.error('执行过程中发生未预期的错误:', error)
    process.exit(1)
  }
})()
