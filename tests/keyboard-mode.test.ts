import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createDefaultActionRegistry } from '../src/actions/registry'
import { defineConfig } from '../src/config'
import { assertValidConfigOverrides } from '../src/config-validate'
import {
	createKeyboardController,
	keyboardToggleButton,
	reportKeyboardUnavailable,
	withKeyboardEscapeHatch,
} from '../src/controls/keyboard-controller'
import { createHookRegistry } from '../src/hooks/registry'
import { createToolbar } from '../src/toolbar/toolbar'
import type { XTerminal } from '../src/types'
import { mockTerminal } from './fixtures'

// vitest runs from the project root; happy-dom rewrites import.meta.url
const css = readFileSync(resolve(process.cwd(), 'styles/base.css'), 'utf8')

beforeEach(() => {
	GlobalRegistrator.register()
})

afterEach(() => {
	GlobalRegistrator.unregister()
	vi.restoreAllMocks()
	vi.useRealTimers()
})

/** Mock terminal with the keyboard suppression semantics of the client bridge */
function mockSuppressionTerm(): {
	term: XTerminal
	calls: string[]
	emitFocus: (focused: boolean) => void
} {
	const calls: string[] = []
	let focusHandler: ((focused: boolean) => void) | null = null
	return {
		calls,
		emitFocus(focused) {
			focusHandler?.(focused)
		},
		term: {
			options: { fontSize: 14 },
			input(_data: string, _wasUserInput: boolean) {},
			focus() {
				calls.push('focus')
			},
			blur() {
				calls.push('blur')
			},
			setKeyboardSuppressed(suppressed: boolean) {
				calls.push(suppressed ? 'suppress' : 'unsuppress')
			},
			onFocusChange(handler: (focused: boolean) => void) {
				focusHandler = handler
				return {
					dispose() {
						focusHandler = null
					},
				}
			},
			onData(_handler: (data: string) => void) {
				return { dispose() {} }
			},
		},
	}
}

/** Install a fake visualViewport with a controllable height */
function fakeVisualViewport(height: number): EventTarget & { height: number } {
	const vv = new EventTarget() as EventTarget & { height: number }
	vv.height = height
	Object.defineProperty(window, 'visualViewport', {
		value: vv,
		writable: true,
		configurable: true,
	})
	return vv
}

function setInnerHeight(height: number): void {
	Object.defineProperty(window, 'innerHeight', {
		value: height,
		writable: true,
		configurable: true,
	})
}

describe('keyboardMode config schema', () => {
	test('defaults to auto', () => {
		expect(defineConfig().mobile.keyboardMode).toBe('auto')
	})

	test('accepts manual via overrides', () => {
		expect(defineConfig({ mobile: { keyboardMode: 'manual' } }).mobile.keyboardMode).toBe('manual')
		expect(() => assertValidConfigOverrides({ mobile: { keyboardMode: 'manual' } })).not.toThrow()
	})

	test('rejects unknown keyboardMode values', () => {
		expect(() => assertValidConfigOverrides({ mobile: { keyboardMode: 'locked' } })).toThrow(
			/keyboardMode/,
		)
	})

	test('accepts keyboard-toggle buttons in config overrides', () => {
		expect(() =>
			assertValidConfigOverrides({
				toolbar: {
					row1: [
						{
							id: 'kb',
							label: '⌨',
							description: 'Toggle the soft keyboard',
							action: { type: 'keyboard-toggle' },
						},
					],
				},
			}),
		).not.toThrow()
	})

	test('default row2 ends with the keyboard-toggle button', () => {
		const row2 = defineConfig().toolbar.row2
		expect(row2[row2.length - 1]).toEqual(keyboardToggleButton)
	})
})

describe('keyboard-toggle action dispatch', () => {
	test('calls the toggleKeyboard dep', async () => {
		const toggleKeyboard = vi.fn()
		const registry = createDefaultActionRegistry({ toggleKeyboard })
		const handled = await registry.execute(
			{ type: 'keyboard-toggle' },
			{
				term: mockTerminal(),
				kbWasOpen: false,
				focusIfNeeded: () => {},
				sendText: async () => {},
			},
		)
		expect(handled).toBe(true)
		expect(toggleKeyboard).toHaveBeenCalledTimes(1)
	})

	test('fails loud when no toggleKeyboard is wired', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		const registry = createDefaultActionRegistry()
		await expect(
			registry.execute(
				{ type: 'keyboard-toggle' },
				{
					term: mockTerminal(),
					kbWasOpen: false,
					focusIfNeeded: () => {},
					sendText: async () => {},
				},
			),
		).rejects.toThrow(/toggleKeyboard/)
	})
})

describe('keyboard controller — manual mode transitions', () => {
	test('starts locked: suppression applied at creation, permission false', () => {
		const { term, calls } = mockSuppressionTerm()
		const controller = createKeyboardController(term, 'manual')
		expect(calls).toEqual(['suppress'])
		expect(controller.hasInputPermission()).toBe(false)
		expect(controller.indicatorOn()).toBe(false)
		controller.dispose()
	})

	test('toggle unlocks: clears suppression, then focuses inside the gesture', () => {
		const { term, calls } = mockSuppressionTerm()
		const controller = createKeyboardController(term, 'manual')
		controller.toggle()
		expect(calls).toEqual(['suppress', 'unsuppress', 'focus'])
		expect(controller.hasInputPermission()).toBe(true)
		expect(controller.indicatorOn()).toBe(true)
		controller.dispose()
	})

	test('second toggle locks again', () => {
		vi.useFakeTimers({ toFake: ['Date'] })
		const { term, calls } = mockSuppressionTerm()
		const controller = createKeyboardController(term, 'manual')
		controller.toggle()
		vi.setSystemTime(Date.now() + 400)
		controller.toggle()
		expect(calls).toEqual(['suppress', 'unsuppress', 'focus', 'suppress'])
		expect(controller.hasInputPermission()).toBe(false)
		expect(controller.indicatorOn()).toBe(false)
		controller.dispose()
	})

	test('★ system-gesture dismiss does not change permission ★', () => {
		const { term, emitFocus } = mockSuppressionTerm()
		setInnerHeight(800)
		const vv = fakeVisualViewport(800)
		const controller = createKeyboardController(term, 'manual')
		controller.toggle()
		expect(controller.hasInputPermission()).toBe(true)

		// System gesture: textarea blurs and the viewport grows back — the lock
		// was never released, so permission must survive unchanged.
		emitFocus(false)
		vv.height = 800
		vv.dispatchEvent(new Event('resize'))

		expect(controller.hasInputPermission()).toBe(true)
		// Manual indicator follows permission, not visibility (V1)
		expect(controller.indicatorOn()).toBe(true)
		controller.dispose()
	})

	test('tracks textarea focus events without touching permission', () => {
		const { term, emitFocus } = mockSuppressionTerm()
		const controller = createKeyboardController(term, 'manual')
		const seen: boolean[] = []
		controller.subscribe(() => seen.push(controller.indicatorOn()))
		emitFocus(true)
		emitFocus(false)
		expect(controller.hasInputPermission()).toBe(false)
		expect(seen).toEqual([false, false])
		controller.dispose()
	})

	test('debounces rapid toggles (~300ms)', () => {
		vi.useFakeTimers({ toFake: ['Date'] })
		const { term, calls } = mockSuppressionTerm()
		const controller = createKeyboardController(term, 'manual')
		controller.toggle()
		controller.toggle()
		controller.toggle()
		expect(calls).toEqual(['suppress', 'unsuppress', 'focus'])
		expect(controller.hasInputPermission()).toBe(true)
		vi.setSystemTime(Date.now() + 301)
		controller.toggle()
		expect(controller.hasInputPermission()).toBe(false)
		controller.dispose()
	})

	test('unavailable mechanism: available=false and toggle throws (fail-loud)', () => {
		const controller = createKeyboardController(mockTerminal(), 'manual')
		expect(controller.available).toBe(false)
		expect(() => controller.toggle()).toThrow(/setKeyboardSuppressed/)
		controller.dispose()
	})
})

describe('keyboard controller — auto mode', () => {
	test('no permission concept; indicator follows keyboard visibility', () => {
		setInnerHeight(800)
		fakeVisualViewport(400) // keyboard open
		const { term } = mockSuppressionTerm()
		const controller = createKeyboardController(term, 'auto')
		expect(controller.hasInputPermission()).toBe(true)
		expect(controller.indicatorOn()).toBe(true)
		controller.dispose()
	})

	test('auto indicator tracks viewport changes', () => {
		setInnerHeight(800)
		const vv = fakeVisualViewport(800)
		const { term } = mockSuppressionTerm()
		const controller = createKeyboardController(term, 'auto')
		expect(controller.indicatorOn()).toBe(false)
		vv.height = 400
		vv.dispatchEvent(new Event('resize'))
		expect(controller.indicatorOn()).toBe(true)
		controller.dispose()
	})

	test('momentary control: focus when unfocused, blur when focused', () => {
		vi.useFakeTimers({ toFake: ['Date'] })
		const { term, calls, emitFocus } = mockSuppressionTerm()
		const controller = createKeyboardController(term, 'auto')
		controller.toggle()
		expect(calls).toEqual(['focus'])
		emitFocus(true)
		vi.setSystemTime(Date.now() + 400)
		controller.toggle()
		expect(calls).toEqual(['focus', 'blur'])
		controller.dispose()
	})

	test('event disorder: stale keyboardVisible never steers the transition (T-B)', () => {
		// Viewport says "open" (resize event delayed/lost) but the textarea is
		// not focused — the toggle must still choose focus, not blur.
		setInnerHeight(800)
		fakeVisualViewport(400) // keyboardVisible=true, possibly stale
		const { term, calls } = mockSuppressionTerm()
		const controller = createKeyboardController(term, 'auto')
		expect(controller.indicatorOn()).toBe(true) // indicator follows visibility
		controller.toggle()
		expect(calls).toEqual(['focus']) // transition follows focus semantics only
		controller.dispose()
	})

	test('auto never applies suppression at creation', () => {
		const { term, calls } = mockSuppressionTerm()
		const controller = createKeyboardController(term, 'auto')
		expect(calls).toEqual([])
		controller.dispose()
	})
})

describe('escape hatch (V2)', () => {
	test('auto mode is returned unchanged', () => {
		const config = defineConfig()
		expect(withKeyboardEscapeHatch(config)).toBe(config)
	})

	test('manual with an existing keyboard-toggle is returned unchanged', () => {
		const config = defineConfig({ mobile: { keyboardMode: 'manual' } })
		// default row2 already ends with ⌨
		expect(withKeyboardEscapeHatch(config)).toBe(config)
	})

	test('keyboard-toggle anywhere (drawer, floating) counts as covered', () => {
		const config = defineConfig({
			mobile: { keyboardMode: 'manual' },
			toolbar: { row2: (defaults) => defaults.filter((b) => b.id !== 'keyboard-toggle') },
			drawer: { buttons: (defaults) => [...defaults, keyboardToggleButton] },
		})
		expect(withKeyboardEscapeHatch(config)).toBe(config)
	})

	test('manual without any keyboard-toggle injects the default into row2', () => {
		const config = defineConfig({
			mobile: { keyboardMode: 'manual' },
			toolbar: { row2: (defaults) => defaults.filter((b) => b.id !== 'keyboard-toggle') },
		})
		const before = config.toolbar.row2.length
		const patched = withKeyboardEscapeHatch(config)
		expect(patched).not.toBe(config)
		expect(patched.toolbar.row2).toHaveLength(before + 1)
		expect(patched.toolbar.row2[patched.toolbar.row2.length - 1]).toEqual(keyboardToggleButton)
		// Pure: the input config is untouched
		expect(config.toolbar.row2).toHaveLength(before)
		expect(config.toolbar.row2.some((b) => b.id === 'keyboard-toggle')).toBe(false)
	})
})

describe('toolbar integration', () => {
	function manualConfig() {
		return defineConfig({
			mobile: { keyboardMode: 'manual' },
			toolbar: { row1: [], row2: [keyboardToggleButton] },
		})
	}

	test('keyboard-toggle button carries the wt-keyboard-toggle class', () => {
		const config = manualConfig()
		const { term } = mockSuppressionTerm()
		const keyboard = createKeyboardController(term, 'manual')
		const { element } = createToolbar(
			term,
			config,
			() => {},
			createHookRegistry(),
			undefined,
			undefined,
			keyboard,
		)
		expect(element.querySelector('.wt-keyboard-toggle')).not.toBeNull()
		keyboard.dispose()
	})

	test('indicator reflects manual permission through the subscription', () => {
		const config = manualConfig()
		const { term } = mockSuppressionTerm()
		const keyboard = createKeyboardController(term, 'manual')
		const { element } = createToolbar(
			term,
			config,
			() => {},
			createHookRegistry(),
			undefined,
			undefined,
			keyboard,
		)
		const button = element.querySelector('.wt-keyboard-toggle')
		expect(button?.classList.contains('wt-kb-active')).toBe(false)
		keyboard.toggle()
		expect(button?.classList.contains('wt-kb-active')).toBe(true)
		keyboard.dispose()
	})

	test('fail-loud: unavailable controller marks buttons and shows an overlay', () => {
		const config = manualConfig()
		const keyboard = createKeyboardController(mockTerminal(), 'manual')
		const { element } = createToolbar(
			mockTerminal(),
			config,
			() => {},
			createHookRegistry(),
			undefined,
			undefined,
			keyboard,
		)
		document.body.appendChild(element)
		reportKeyboardUnavailable(keyboard)
		expect(document.getElementById('wt-keyboard-unavailable')).not.toBeNull()
		expect(
			document.querySelector('.wt-keyboard-toggle')?.classList.contains('wt-action-error'),
		).toBe(true)
		keyboard.dispose()
	})

	test('keyboard-toggle prevents synthesised mouse events on touchend (探针③ race)', () => {
		// Emulator-verified: without this, the synthesised mousedown after
		// touchend steals the unlock focus back to the button and the soft
		// keyboard never opens.
		const config = defineConfig({
			toolbar: {
				row1: [
					{ id: 'q', label: 'q', description: 'Send q key', action: { type: 'send', data: 'q' } },
				],
				row2: [keyboardToggleButton],
			},
		})
		const { element } = createToolbar(mockTerminal(), config, () => {}, createHookRegistry())
		const toggle = element.querySelector('.wt-keyboard-toggle')
		const plain = element.querySelector('button:not(.wt-keyboard-toggle)')
		const toggleEvent = new Event('touchend', { cancelable: true })
		toggle?.dispatchEvent(toggleEvent)
		expect(toggleEvent.defaultPrevented).toBe(true)
		const plainEvent = new Event('touchend', { cancelable: true })
		plain?.dispatchEvent(plainEvent)
		expect(plainEvent.defaultPrevented).toBe(false)
	})
})

describe('base.css keyboard rules', () => {
	test('landscape wt-kb-open exempts the keyboard-toggle (F1)', () => {
		expect(css).toContain(
			'#wt-toolbar.wt-kb-open .wt-row:last-child button:not(.wt-keyboard-toggle)',
		)
		// The old whole-row hide must be gone
		expect(css).not.toMatch(/#wt-toolbar\.wt-kb-open \.wt-row:last-child \{/)
	})

	test('row2 scrolls horizontally on narrow screens with 44px minimum targets (V2)', () => {
		const rowBlock = css.match(/#wt-toolbar \.wt-row:last-child \{([^}]*)\}/)
		expect(rowBlock?.[1]).toContain('overflow-x: auto')
		const buttonBlock = css.match(/#wt-toolbar \.wt-row:last-child button \{([^}]*)\}/)
		expect(buttonBlock?.[1]).toContain('min-width: 44px')
	})

	test('keyboard indicator style exists', () => {
		expect(css).toContain('#wt-toolbar button.wt-keyboard-toggle.wt-kb-active')
	})
})

describe('init lifecycle (P2-1)', () => {
	test('dispose consumes keyboard.dispose — old controller stops receiving events', async () => {
		Object.defineProperty(navigator, 'maxTouchPoints', { value: 1, configurable: true })
		// happy-dom lacks document.fonts
		Object.defineProperty(document, 'fonts', {
			value: { ready: Promise.resolve() },
			configurable: true,
		})
		setInnerHeight(800)
		fakeVisualViewport(800)

		const focusDispose = vi.fn()
		let focusHandler: ((focused: boolean) => void) | null = null
		const term: XTerminal = {
			options: { fontSize: 14 },
			input(_data: string, _wasUserInput: boolean) {},
			focus() {},
			blur() {},
			setKeyboardSuppressed(_suppressed: boolean) {},
			onFocusChange(handler: (focused: boolean) => void) {
				focusHandler = handler
				return { dispose: focusDispose }
			},
			onData(_handler: (data: string) => void) {
				return { dispose() {} }
			},
		}
		window.term = term

		const { init } = await import('../src/index')
		init(defineConfig({ mobile: { keyboardMode: 'manual' } }))

		// Wait until init has rendered the toolbar (controller created before it)
		await vi.waitFor(
			() => {
				expect(document.getElementById('wt-toolbar')).not.toBeNull()
			},
			{ timeout: 5000 },
		)
		expect(focusHandler).not.toBeNull()

		// pagehide/beforeunload path → dispose → keyboard.dispose()
		window.dispatchEvent(new Event('beforeunload'))
		expect(focusDispose).toHaveBeenCalledTimes(1)
	})
})
