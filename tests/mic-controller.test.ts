import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type {
	AsrEngine,
	AsrErrorCode,
	AsrErrorHandler,
	AsrFinalHandler,
	AsrTextHandler,
} from '../src/asr/types'
import { defineConfig } from '../src/config'
import {
	createMicController,
	isVoiceInputSupported,
	sanitizeVoiceText,
} from '../src/controls/mic-controller'
import { createHookRegistry } from '../src/hooks/registry'
import type { XTerminal } from '../src/types'
import { _resetTouchGuard } from '../src/util/tap'
import { mockTerminalWithSent } from './fixtures'

class FakeEngine implements AsrEngine {
	starts = 0
	stops = 0
	rejectStops = false
	private startResolve: (() => void) | undefined
	private startReject: ((error: unknown) => void) | undefined
	private partial: AsrTextHandler | undefined
	private final: AsrFinalHandler | undefined
	private error: AsrErrorHandler | undefined

	start(): Promise<void> {
		this.starts++
		return new Promise<void>((resolve, reject) => {
			this.startResolve = resolve
			this.startReject = reject
		})
	}

	resolveStart(): void {
		const resolve = this.startResolve
		this.startResolve = undefined
		this.startReject = undefined
		resolve?.()
	}

	rejectStart(error: unknown): void {
		const reject = this.startReject
		this.startResolve = undefined
		this.startReject = undefined
		reject?.(error)
	}

	stop(): Promise<void> {
		this.stops++
		return this.rejectStops ? Promise.reject(new Error('stop failed')) : Promise.resolve()
	}

	isSupported(): boolean {
		return true
	}

	onPartial(handler: AsrTextHandler): () => void {
		this.partial = handler
		return () => {
			if (this.partial === handler) this.partial = undefined
		}
	}

	onFinal(handler: AsrFinalHandler): () => void {
		this.final = handler
		return () => {
			if (this.final === handler) this.final = undefined
		}
	}

	onError(handler: AsrErrorHandler): () => void {
		this.error = handler
		return () => {
			if (this.error === handler) this.error = undefined
		}
	}

	emitPartial(text: string): void {
		this.partial?.(text)
	}

	emitFinal(text: string, sequence?: number): void {
		this.final?.(text, sequence)
	}

	emitError(code: AsrErrorCode): void {
		this.error?.(code)
	}
}

interface TestHarness {
	readonly button: HTMLButtonElement
	readonly textarea: HTMLTextAreaElement | undefined
	readonly engine: FakeEngine
	readonly term: XTerminal & { readonly sent: string[] }
	readonly controller: NonNullable<ReturnType<typeof createMicController>>
	setConnected(connected: boolean): void
}

function createHarness(
	autoEnter = false,
	hooks = createHookRegistry(),
	withTextarea = false,
): TestHarness {
	const engine = new FakeEngine()
	const baseTerm = mockTerminalWithSent()
	const textarea = withTextarea ? document.createElement('textarea') : undefined
	if (textarea) document.body.append(textarea)
	let connected = true
	const listeners = new Set<(value: boolean) => void>()
	const term = {
		...baseTerm,
		focus() {
			textarea?.focus()
		},
		isConnected: () => connected,
		onConnectionChange(handler: (value: boolean) => void) {
			listeners.add(handler)
			return { dispose: () => listeners.delete(handler) }
		},
	}
	const config = defineConfig({
		asr: { enabled: true, autoEnter, doubao: { apiKey: 'test-key' } },
	})
	const controller = createMicController({
		term,
		config,
		hooks,
		engine,
	})
	if (!controller) throw new Error('expected injected fake engine to create controller')
	const button = document.createElement('button')
	controller.attach(button)
	document.body.append(button)
	return {
		button,
		textarea,
		engine,
		term,
		controller,
		setConnected(value) {
			connected = value
			for (const listener of listeners) listener(value)
		},
	}
}

function dispatchTap(button: HTMLButtonElement): void {
	button.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }))
}

function dispatchTouchTap(button: HTMLButtonElement): void {
	button.dispatchEvent(new Event('touchend', { bubbles: true, cancelable: true }))
}

async function startRecording(harness: TestHarness): Promise<void> {
	dispatchTap(harness.button)
	harness.engine.resolveStart()
	await Promise.resolve()
	await Promise.resolve()
	expect(harness.controller.state).toBe('recording')
	expect(harness.button.getAttribute('aria-pressed')).toBe('true')
	expect(harness.button.classList.contains('wt-mic-recording')).toBe(true)
}

beforeEach(() => {
	GlobalRegistrator.register()
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		value: 'visible',
	})
	vi.useFakeTimers()
})

afterEach(() => {
	_resetTouchGuard()
	GlobalRegistrator.unregister()
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe('sanitizeVoiceText', () => {
	test('keeps printable bytes and spaces, strips C0/DEL/C1', () => {
		const input = 'A\x00B\tC\nD\rE\x7fF\x80G\x9fH \u4f60\u597d'
		expect(new TextEncoder().encode(sanitizeVoiceText(input))).toEqual(
			new TextEncoder().encode('ABCDEFGH \u4f60\u597d'),
		)
	})

	test('strips zero-width, format, bidi, line-separator, and paragraph-separator code points', () => {
		const input = 'A\u200bB\u202aC\u2028D\u2029E\ufeffF e\u0301'
		expect(new TextEncoder().encode(sanitizeVoiceText(input))).toEqual(
			new TextEncoder().encode('ABCDEF e\u0301'),
		)
	})

	test('empty input remains empty', () => {
		expect(sanitizeVoiceText('\x00\r\n\t\x7f\x80\x9f')).toBe('')
	})
})

describe('mic-controller tap-to-toggle state machine', () => {
	test('tap starts connecting immediately and a second tap cancels', () => {
		const harness = createHarness()
		expect(harness.button.getAttribute('aria-label')).toBe('Tap to speak')
		expect(harness.button.getAttribute('aria-pressed')).toBe('false')
		dispatchTap(harness.button)
		expect(harness.controller.state).toBe('connecting')
		expect(harness.engine.starts).toBe(1)
		dispatchTap(harness.button)
		expect(harness.controller.state).toBe('idle')
		expect(harness.engine.stops).toBe(1)
		expect(harness.controller.preview.message.textContent).toContain('cancelled')
		harness.controller.dispose()
	})

	test('touch tap does not toggle again on the synthesised click', () => {
		const harness = createHarness()
		harness.button.dispatchEvent(new Event('touchend', { bubbles: true, cancelable: true }))
		dispatchTap(harness.button)
		expect(harness.controller.state).toBe('connecting')
		expect(harness.engine.starts).toBe(1)
		harness.controller.dispose()
	})

	test('tap preserves terminal textarea focus with keyboard closed or open', () => {
		const closed = createHarness(false, createHookRegistry(), true)
		if (!closed.textarea) throw new Error('expected focus target')
		closed.textarea.focus()
		dispatchTouchTap(closed.button)
		expect(document.activeElement).toBe(closed.textarea)
		closed.controller.dispose()

		Object.defineProperty(window, 'innerHeight', {
			configurable: true,
			value: 800,
		})
		Object.defineProperty(window, 'visualViewport', {
			configurable: true,
			value: { height: 400 },
		})
		const open = createHarness(false, createHookRegistry(), true)
		if (!open.textarea) throw new Error('expected focus target')
		open.textarea.focus()
		dispatchTouchTap(open.button)
		expect(document.activeElement).toBe(open.textarea)
		open.controller.dispose()
	})

	test('recording tap transitions to waiting-final', async () => {
		const harness = createHarness()
		await startRecording(harness)
		dispatchTap(harness.button)
		expect(harness.controller.state).toBe('waiting-final')
		expect(harness.engine.stops).toBe(1)
		harness.controller.dispose()
	})

	test('connecting tap cancels the started engine', () => {
		const harness = createHarness()
		dispatchTap(harness.button)
		expect(harness.controller.state).toBe('connecting')
		dispatchTap(harness.button)
		expect(harness.controller.state).toBe('idle')
		expect(harness.engine.stops).toBe(1)
		harness.controller.dispose()
	})

	test('partial text is streamed through an animation frame', async () => {
		const harness = createHarness()
		await startRecording(harness)
		harness.engine.emitPartial('partial text')
		expect(harness.controller.preview.input.value).toBe('')
		vi.advanceTimersByTime(20)
		expect(harness.controller.preview.input.value).toBe('partial text')
		expect(harness.controller.preview.input.hasAttribute('inputmode')).toBe(false)
		harness.controller.dispose()
	})

	test('final text overwrites partial and discards stale or late sequences', async () => {
		const harness = createHarness()
		await startRecording(harness)
		dispatchTap(harness.button)
		harness.engine.emitPartial('partial')
		vi.advanceTimersByTime(20)
		harness.engine.emitFinal('final-2', 2)
		expect(harness.controller.state).toBe('preview')
		expect(harness.controller.preview.input.value).toBe('final-2')
		harness.engine.emitFinal('stale-1', 1)
		expect(harness.controller.preview.input.value).toBe('final-2')
		harness.engine.emitFinal('new-3', 3)
		expect(harness.controller.preview.input.value).toBe('final-2')
		harness.controller.dispose()
	})

	test('waiting-final timeout preserves recognized text for manual sending', async () => {
		const harness = createHarness()
		await startRecording(harness)
		harness.engine.emitPartial('keep me')
		vi.advanceTimersByTime(20)
		dispatchTap(harness.button)
		vi.advanceTimersByTime(3_000)
		expect(harness.controller.state).toBe('preview')
		expect(harness.controller.preview.input.value).toBe('keep me')
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
		expect(() => document.dispatchEvent(new Event('visibilitychange'))).not.toThrow()
		expect(harness.controller.state).toBe('idle')
		harness.controller.dispose()
	})

	test('permission denial enters error and visibility cancellation returns to idle', async () => {
		const harness = createHarness()
		dispatchTap(harness.button)
		harness.engine.rejectStart(new DOMException('permission denied', 'NotAllowedError'))
		await Promise.resolve()
		await Promise.resolve()
		expect(harness.controller.state).toBe('error')
		expect(harness.controller.preview.message.textContent).toContain('permission')
		dispatchTap(harness.button)
		expect(harness.controller.state).toBe('error')
		expect(harness.engine.starts).toBe(1)
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
		expect(() => document.dispatchEvent(new Event('visibilitychange'))).not.toThrow()
		expect(harness.controller.state).toBe('idle')
		harness.controller.dispose()
	})

	test('connection timeout enters error and audio interruption cancels recording', async () => {
		const timeout = createHarness()
		dispatchTap(timeout.button)
		vi.advanceTimersByTime(5_000)
		expect(timeout.controller.state).toBe('error')
		timeout.controller.dispose()

		const cancelled = createHarness()
		await startRecording(cancelled)
		cancelled.engine.emitError('audio-interrupted')
		expect(cancelled.controller.state).toBe('idle')
		expect(cancelled.controller.preview.message.textContent).toContain('cancelled')
		cancelled.controller.dispose()
	})

	test('stop rejection is observable while cancellation still reaches idle', async () => {
		const harness = createHarness()
		harness.engine.rejectStops = true
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		dispatchTap(harness.button)
		dispatchTap(harness.button)
		await Promise.resolve()
		expect(harness.controller.state).toBe('idle')
		expect(error).toHaveBeenCalledWith('remobi: ASR stop failed', expect.any(Error))
		harness.controller.dispose()
	})

	test('audio interruption and visibility hidden cancel any active recording', async () => {
		const first = createHarness()
		await startRecording(first)
		first.engine.emitError('audio-interrupted')
		expect(first.controller.state).toBe('idle')
		expect(first.controller.preview.message.textContent).toContain('interrupted')
		first.controller.dispose()

		const second = createHarness()
		await startRecording(second)
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			value: 'hidden',
		})
		document.dispatchEvent(new Event('visibilitychange'))
		expect(second.controller.state).toBe('idle')
		second.controller.dispose()
	})

	test('tap in preview does not start a new session', async () => {
		const harness = createHarness()
		await startRecording(harness)
		dispatchTap(harness.button)
		harness.engine.emitFinal('preview text', 1)
		dispatchTap(harness.button)
		expect(harness.engine.starts).toBe(1)
		expect(harness.controller.state).toBe('preview')
		harness.controller.dispose()
	})
})

describe('preview injection', () => {
	test('runs hook, sanitizes last, sends text then independent autoEnter', async () => {
		const harness = createHarness(true)
		await startRecording(harness)
		dispatchTap(harness.button)
		harness.engine.emitFinal('ignored', 1)
		const hookCalls: string[] = []
		const hooks = createHookRegistry()
		hooks.on('beforeSendData', ({ data }) => {
			hookCalls.push(`before:${data}`)
			return { data: `${data}\r\n\t\x80\x7f\x9f` }
		})
		hooks.on('afterSendData', ({ data }) => {
			hookCalls.push(`after:${data}`)
		})
		// The controller's hook registry is fixed at construction; use a new
		// harness-shaped controller to assert the actual injection seam.
		harness.controller.dispose()
		const engine = new FakeEngine()
		const term = harness.term
		const config = defineConfig({
			asr: { enabled: true, autoEnter: true, doubao: { apiKey: 'test-key' } },
		})
		const controller = createMicController({ term, config, hooks, engine })
		if (!controller) throw new Error('expected controller')
		const button = document.createElement('button')
		controller.attach(button)
		document.body.append(button)
		dispatchTap(button)
		engine.resolveStart()
		await Promise.resolve()
		await Promise.resolve()
		dispatchTap(button)
		engine.emitFinal('printf "voice\x00-input\\n"', 1)
		const sendButton = controller.preview.element.querySelector('button:last-child')
		sendButton?.dispatchEvent(new Event('click'))
		for (let index = 0; index < 8; index++) await Promise.resolve()
		expect(term.sent).toEqual(['printf "voice-input\\n"', '\r'])
		expect(hookCalls[0]).toContain('before:')
		expect(hookCalls[1]).toBe('after:printf "voice-input\\n"')
		expect(controller.state).toBe('idle')
		controller.dispose()
	})

	test('disconnected terminal keeps preview and does not use send queue', async () => {
		const harness = createHarness()
		await startRecording(harness)
		dispatchTap(harness.button)
		harness.engine.emitFinal('kept text', 1)
		harness.setConnected(false)
		const sendButton = harness.controller.preview.element.querySelector('button:last-child')
		sendButton?.dispatchEvent(new Event('click'))
		await Promise.resolve()
		expect(harness.term.sent).toEqual([])
		expect(harness.controller.state).toBe('preview')
		expect(harness.controller.preview.message.textContent).toContain('disconnected')
		harness.controller.dispose()
	})

	test('disconnect during after-send hook blocks the independent autoEnter write', async () => {
		const hooks = createHookRegistry()
		const harness = createHarness(true, hooks)
		hooks.on('afterSendData', async () => {
			harness.setConnected(false)
			await Promise.resolve()
		})
		await startRecording(harness)
		dispatchTap(harness.button)
		harness.engine.emitFinal('typed command', 1)
		harness.controller.preview.input.value = 'typed command'
		harness.controller.preview.element
			.querySelector('button:last-child')
			?.dispatchEvent(new Event('click'))
		for (let index = 0; index < 8; index++) await Promise.resolve()
		expect(harness.term.sent).toEqual(['typed command'])
		expect(harness.controller.state).toBe('preview')
		expect(harness.controller.preview.message.textContent).toContain('disconnected')
		harness.controller.dispose()
	})

	test('late final after waiting timeout cannot overwrite edited preview text', async () => {
		const harness = createHarness()
		await startRecording(harness)
		harness.engine.emitPartial('recognized')
		vi.advanceTimersByTime(20)
		dispatchTap(harness.button)
		vi.advanceTimersByTime(3_000)
		expect(harness.controller.state).toBe('preview')
		harness.controller.preview.input.value = 'user edit'
		harness.engine.emitFinal('late provider result', 2)
		expect(harness.controller.preview.input.value).toBe('user edit')
		harness.controller.dispose()
	})

	test('empty preview does not inject or auto-enter', async () => {
		const harness = createHarness(true)
		await startRecording(harness)
		dispatchTap(harness.button)
		harness.engine.emitFinal('', 1)
		const sendButton = harness.controller.preview.element.querySelector('button:last-child')
		sendButton?.dispatchEvent(new Event('click'))
		await Promise.resolve()
		expect(harness.term.sent).toEqual([])
		harness.controller.dispose()
	})
})

describe('capability detection', () => {
	test('requires secure context and getUserMedia', () => {
		Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: false })
		Object.defineProperty(navigator, 'mediaDevices', {
			configurable: true,
			value: { getUserMedia() {} },
		})
		expect(isVoiceInputSupported()).toBe(false)
		Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true })
		expect(isVoiceInputSupported()).toBe(true)
	})
})
