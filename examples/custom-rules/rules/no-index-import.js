/**
 * 
 * 
 * 
 * 
 */
const { defineRule, RuleSeverity } = require('../../../packages/auto-cr-rules/dist')

module.exports = defineRule('no-index-import', {severity: RuleSeverity.Warning }, ({ helpers, language }) => {
  for (const ref of helpers.imports) {
    if (ref.value.endsWith('/index')) {
      const message =
        language === 'zh'
          ? `禁止直接导入 ${ref.value}，请改用具体文件`
          : `Import ${ref.value} is not allowed. Import the concrete file instead.`

      helpers.reportViolation(message, ref.span)
    }
  }
})
