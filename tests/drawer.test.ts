import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { defineConfig } from '../src/config'
import { createDrawer } from '../src/drawer/drawer'
import { createHookRegistry } from '../src/hooks/registry'
import { _resetTouchGuard } from '../src/util/tap'
import { mockTerminal } from './fixtures'

beforeEach(() => {
	GlobalRegistrator.register()
	_resetTouchGuard()
})

afterEach(() => {
	GlobalRegistrator.unregister()
})

function makeDrawer() {
	const config = defineConfig()
	return createDrawer(mockTerminal(), config.drawer.buttons, {
		hooks: createHookRegistry(),
		appConfig: config,
	})
}

describe('drawer close paths', () => {
	test('renders a visible × close button in the handle area', () => {
		const { drawer } = makeDrawer()
		const closeButton = drawer.querySelector<HTMLButtonElement>('#wt-drawer-close')

		expect(closeButton).not.toBeNull()
		expect(closeButton?.textContent).toBe('×')
		expect(closeButton?.getAttribute('aria-label')).toBe('Close drawer')
		// Lives next to the drag handle
		expect(closeButton?.parentElement?.id).toBe('wt-drawer-header')
		expect(drawer.querySelector('#wt-drawer-header #wt-drawer-handle')).not.toBeNull()
	})

	test('tapping × closes the drawer (class + backdrop)', () => {
		const { backdrop, drawer, open, isOpen } = makeDrawer()
		open()
		expect(isOpen()).toBe(true)

		drawer.querySelector<HTMLButtonElement>('#wt-drawer-close')?.click()

		expect(isOpen()).toBe(false)
		expect(drawer.classList.contains('open')).toBe(false)
		expect(backdrop.style.display).toBe('none')
	})

	test('backdrop tap still closes the drawer', () => {
		const { backdrop, drawer, open, isOpen } = makeDrawer()
		open()

		backdrop.click()

		expect(isOpen()).toBe(false)
		expect(drawer.classList.contains('open')).toBe(false)
	})

	test('↑ ↓ fallback buttons are reachable in the default drawer grid', () => {
		const { drawer } = makeDrawer()
		const labels = [...drawer.querySelectorAll('#wt-drawer-grid button')].map((b) => b.textContent)
		expect(labels).toContain('↑')
		expect(labels).toContain('↓')
	})
})
