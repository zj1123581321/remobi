import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { FONT_SIZE_STORAGE_KEY } from '../src/actions/registry'
import { defineConfig } from '../src/config'
import type { XTerminal } from '../src/types'

beforeEach(() => {
	GlobalRegistrator.register()
})

afterEach(() => {
	GlobalRegistrator.unregister()
	vi.restoreAllMocks()
})

function setInnerHeight(height: number): void {
	Object.defineProperty(window, 'innerHeight', {
		value: height,
		writable: true,
		configurable: true,
	})
}

/** Boot the overlay on a mock mobile terminal and return it once rendered */
async function bootOverlay(): Promise<XTerminal> {
	Object.defineProperty(navigator, 'maxTouchPoints', { value: 1, configurable: true })
	// happy-dom lacks document.fonts
	Object.defineProperty(document, 'fonts', {
		value: { ready: Promise.resolve() },
		configurable: true,
	})
	setInnerHeight(800)

	const term: XTerminal = {
		options: { fontSize: 14 },
		input(_data: string, _wasUserInput: boolean) {},
		focus() {},
		blur() {},
		setKeyboardSuppressed(_suppressed: boolean) {},
		onFocusChange(_handler: (focused: boolean) => void) {
			return { dispose() {} }
		},
		onData(_handler: (data: string) => void) {
			return { dispose() {} }
		},
	}
	window.term = term

	const { init } = await import('../src/index')
	init(defineConfig())

	await vi.waitFor(
		() => {
			expect(document.getElementById('wt-toolbar')).not.toBeNull()
		},
		{ timeout: 5000 },
	)
	return term
}

describe('font size persistence (localStorage remobi:fontSize)', () => {
	test('no persisted value — config default (13) applies', async () => {
		const term = await bootOverlay()
		expect(term.options.fontSize).toBe(13)
	})

	test('persisted value wins over the config default', async () => {
		localStorage.setItem(FONT_SIZE_STORAGE_KEY, '20')
		const term = await bootOverlay()
		expect(term.options.fontSize).toBe(20)
	})

	test('corrupt persisted value falls back to the config default', async () => {
		localStorage.setItem(FONT_SIZE_STORAGE_KEY, 'huge')
		const term = await bootOverlay()
		expect(term.options.fontSize).toBe(13)
	})

	test('localStorage read failure (iOS private mode) — logs and uses the default', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('SecurityError')
		})
		const term = await bootOverlay()
		expect(term.options.fontSize).toBe(13)
		expect(errorSpy).toHaveBeenCalled()
	})
})
