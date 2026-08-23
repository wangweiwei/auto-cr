declare const lang: string
declare const pluginName: string
declare const base: string

// Fully dynamic specifier: nothing for a bundler to resolve.
export const loadPlugin = () => import(pluginName)

// Concatenation is just as opaque.
export const loadFromBase = () => import(base + '/entry.js')

// A template literal without a static relative prefix is still fully dynamic.
export const loadLocaleBare = () => import(`${base}/locales/${lang}.js`)

// require() with a variable has the same problem.
export const requirePlugin = () => require(pluginName)

// --- Compliant ---

// Literal specifiers are statically resolvable.
export const loadStatic = () => import('./static-module')
export const requireStatic = () => require('./static-module')

// A template literal without interpolation is effectively a literal.
export const loadStaticTemplate = () => import(`./static-module`)

// A static relative prefix is the bundler-supported dynamic form.
export const loadLocale = () => import(`./locales/${lang}.js`)
export const loadShared = () => import(`../shared/${lang}/index.js`)

// Conditional loading: one literal import() per branch.
export const loadByFlag = (flag: boolean) => (flag ? import('./a') : import('./b'))
