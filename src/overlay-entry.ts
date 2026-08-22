import { createHookRegistry, init } from './index'
import type { HerdwebConfig } from './types'

declare const __herdwebConfig: HerdwebConfig
declare const __herdwebVersion: string | undefined
const config = __herdwebConfig
const version = typeof __herdwebVersion !== 'undefined' ? __herdwebVersion : undefined
const hooks = createHookRegistry()
init(config, hooks, version)
