// This import intentionally goes four levels up, exceeding the rule's allowed depth.
import { formatName } from '../../../../shared/deep/utils'
import { TITLE } from '../../consts/index'

const rawUser = { name: '  user  ' }
const displayName = formatName(rawUser.name)

console.log('Dashboard loaded for', displayName, TITLE)
