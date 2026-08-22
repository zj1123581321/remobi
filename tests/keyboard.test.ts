import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { conditionalFocus, isKeyboardOpen, resetKeyboardHeightBaseline } from '../src/util/keyboard'
import { mockTerminalWithFocus } from './fixtures'

beforeEach(() => {
	GlobalRegistrator.register()
	resetKeyboardHeightBaseline()
})

afterEach(() => {
	GlobalRegistrator.unregister()
})

describe('isKeyboardOpen', () => {
	test('returns false when visualViewport is not available', () => {
		// happy-dom does not provide visualViewport by default
		expect(isKeyboardOpen()).toBe(false)
	})

	test('returns false when viewport height matches innerHeight', () => {
		Object.defineProperty(window, 'visualViewport', {
			value: { height: window.innerHeight },
			writable: true,
			configurable: true,
		})
		expect(isKeyboardOpen()).toBe(false)
	})

	test('returns true when viewport gap exceeds threshold', () => {
		Object.defineProperty(window, 'innerHeight', {
			value: 800,
			writable: true,
			configurable: true,
		})
		Object.defineProperty(window, 'visualViewport', {
			value: { height: 400 },
			writable: true,
			configurable: true,
		})
		expect(isKeyboardOpen()).toBe(true)
	})

	test('detects the keyboard when innerHeight shrinks with the viewport (resizes-content)', () => {
		const vv = { height: 800 }
		Object.defineProperty(window, 'innerHeight', {
			value: 800,
			writable: true,
			configurable: true,
		})
		Object.defineProperty(window, 'visualViewport', {
			value: vv,
			writable: true,
			configurable: true,
		})
		expect(isKeyboardOpen()).toBe(false)

		// Keyboard opens: innerHeight and vp.height shrink together — the plain
		// diff stays ~0, so detection must use the observed ceiling instead.
		Object.defineProperty(window, 'innerHeight', {
			value: 500,
			writable: true,
			configurable: true,
		})
		vv.height = 500
		expect(isKeyboardOpen()).toBe(true)
	})

	test('resetKeyboardHeightBaseline clears the observed ceiling', () => {
		Object.defineProperty(window, 'innerHeight', {
			value: 800,
			writable: true,
			configurable: true,
		})
		Object.defineProperty(window, 'visualViewport', {
			value: { height: 800 },
			writable: true,
			configurable: true,
		})
		expect(isKeyboardOpen()).toBe(false)

		// Simulate orientation change: smaller screen, keyboard closed
		resetKeyboardHeightBaseline()
		Object.defineProperty(window, 'innerHeight', {
			value: 400,
			writable: true,
			configurable: true,
		})
		Object.defineProperty(window, 'visualViewport', {
			value: { height: 400 },
			writable: true,
			configurable: true,
		})
		expect(isKeyboardOpen()).toBe(false)
	})
})

describe('conditionalFocus', () => {
	test('focuses terminal when keyboard was open', () => {
		const term = mockTerminalWithFocus()
		conditionalFocus(term, true)
		expect(term.focused).toBe(true)
	})

	test('does not focus terminal when keyboard was closed', () => {
		const term = mockTerminalWithFocus()
		conditionalFocus(term, false)
		expect(term.focused).toBe(false)
	})
})
