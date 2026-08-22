# Hooks

Lifecycle hooks for herdweb. Only reference this if the user asks about analytics, action filtering, custom DOM, or conditional behaviour.

## Overview

Hooks are registered programmatically — they are not part of `defineConfig()`. Import `createHookRegistry` from the public API and register handlers. Each hook receives typed context and runs asynchronously. Errors are caught and logged without stopping other hooks.

## SendSource type

```typescript
type SendSource = 'toolbar' | 'drawer' | 'floating-buttons' | 'mobile-init'
```

## Hook reference

| Hook | Fires when | Can modify? |
|------|-----------|-------------|
| `beforeSendData` | Before terminal input is sent | Yes — return `{ block: true }` to prevent, or `{ data: '...' }` to rewrite |
| `afterSendData` | After data is sent | No (observation only) |
| `overlayInitStart` | Overlay initialisation begins | No |
| `overlayReady` | Overlay fully initialised and wired | No |
| `toolbarCreated` | Toolbar DOM mounted | No (but can modify DOM) |
| `drawerCreated` | Drawer DOM mounted | No (but can modify DOM) |

## Registration API

```typescript
const hooks = createHookRegistry()
const { dispose } = hooks.on('beforeSendData', async (ctx) => {
  console.log(`Sending ${ctx.data} from ${ctx.source}`)
  return {}
})
```

`dispose()` removes the handler.

## Examples

**Block dangerous commands:**

```typescript
hooks.on('beforeSendData', async (ctx) => {
  if (ctx.data.includes('rm -rf')) return { block: true }
  return {}
})
```

**Add custom DOM to toolbar:**

```typescript
hooks.on('toolbarCreated', async (ctx) => {
  const indicator = document.createElement('span')
  indicator.textContent = 'LIVE'
  indicator.style.color = '#a6e3a1'
  ctx.toolbar.prepend(indicator)
})
```
