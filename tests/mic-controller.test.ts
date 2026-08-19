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
import { mockTerminalWithSent } from './fixtures'

class FakeEngine implements AsrEngine {
	starts = 0
	stops = 0
	private startResolve: (() => void) | undefined
	private partial: AsrTextHandler | undefined
	private final: AsrFinalHandler | undefined
	private error: AsrErrorHandler | undefined

	start(): Promise<void> {
		this.starts++
		return new Promise<void>((resolve) => {
			this.startResolve = resolve
		})
	}

	resolveStart(): void {
		const resolve = this.startResolve
		this.startResolve = undefined
		resolve?.()
	}

	stop(): Promise<void> {
		this.stops++
		return Promise.resolve()
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
	readonly engine: FakeEngine
	readonly term: XTerminal & { readonly sent: string[] }
	readonly controller: NonNullable<ReturnType<typeof createMicController>>
	setConnected(connected: boolean): void
}

function createHarness(autoEnter = false): TestHarness {
	const engine = new FakeEngine()
	const baseTerm = mockTerminalWithSent()
	let connected = true
	const listeners = new Set<(value: boolean) => void>()
	const term = {
		...baseTerm,
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
		hooks: createHookRegistry(),
		engine,
	})
	if (!controller) throw new Error('expected injected fake engine to create controller')
	const button = document.createElement('button')
	controller.attach(button)
	document.body.append(button)
	return {
		button,
		engine,
		term,
		controller,
		setConnected(value) {
			connected = value
			for (const listener of listeners) listener(value)
		},
	}
}

function dispatchPointer(button: HTMLButtonElement, type: string): void {
	const event = new Event(type, { bubbles: true, cancelable: true })
	Object.defineProperty(event, 'pointerId', { value: 1 })
	button.dispatchEvent(event)
}

async function startRecording(harness: TestHarness): Promise<void> {
	dispatchPointer(harness.button, 'pointerdown')
	vi.advanceTimersByTime(300)
	harness.engine.resolveStart()
	await Promise.resolve()
	await Promise.resolve()
	expect(harness.controller.state).toBe('recording')
}

beforeEach(() => {
	GlobalRegistrator.register()
	vi.useFakeTimers()
})

afterEach(() => {
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

	test('empty input remains empty', () => {
		expect(sanitizeVoiceText('\x00\r\n\t\x7f\x80\x9f')).toBe('')
	})
})

describe('mic-controller PTT state machine', () => {
	test('pointerdown enters permission-requesting and a short tap cancels without connecting', () => {
		const harness = createHarness()
		dispatchPointer(harness.button, 'pointerdown')
		expect(harness.controller.state).toBe('permission-requesting')
		vi.advanceTimersByTime(299)
		dispatchPointer(harness.button, 'pointerup')
		expect(harness.controller.state).toBe('idle')
		expect(harness.engine.starts).toBe(0)
		harness.controller.dispose()
	})

	test('hold transitions connecting → recording and pointerup waits for final', async () => {
		const harness = createHarness()
		await startRecording(harness)
		dispatchPointer(harness.button, 'pointerup')
		expect(harness.controller.state).toBe('waiting-final')
		expect(harness.engine.stops).toBe(1)
		harness.controller.dispose()
	})

	test('pointerup during connecting cancels the started engine', () => {
		const harness = createHarness()
		dispatchPointer(harness.button, 'pointerdown')
		vi.advanceTimersByTime(300)
		expect(harness.controller.state).toBe('connecting')
		dispatchPointer(harness.button, 'pointerup')
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

	test('final text overwrites partial and deduplicates stale sequences', async () => {
		const harness = createHarness()
		await startRecording(harness)
		dispatchPointer(harness.button, 'pointerup')
		harness.engine.emitPartial('partial')
		vi.advanceTimersByTime(20)
		harness.engine.emitFinal('final-2', 2)
		expect(harness.controller.state).toBe('preview')
		expect(harness.controller.preview.input.value).toBe('final-2')
		harness.engine.emitFinal('stale-1', 1)
		expect(harness.controller.preview.input.value).toBe('final-2')
		harness.engine.emitFinal('new-3', 3)
		expect(harness.controller.preview.input.value).toBe('new-3')
		harness.controller.dispose()
	})

	test('waiting-final timeout preserves recognized text for manual sending', async () => {
		const harness = createHarness()
		await startRecording(harness)
		harness.engine.emitPartial('keep me')
		vi.advanceTimersByTime(20)
		dispatchPointer(harness.button, 'pointerup')
		vi.advanceTimersByTime(3_000)
		expect(harness.controller.state).toBe('preview')
		expect(harness.controller.preview.input.value).toBe('keep me')
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

	test('second pointerdown while active is ignored', async () => {
		const harness = createHarness()
		await startRecording(harness)
		dispatchPointer(harness.button, 'pointerdown')
		expect(harness.engine.starts).toBe(1)
		harness.controller.dispose()
	})
})

describe('preview injection', () => {
	test('runs hook, sanitizes last, sends text then independent autoEnter', async () => {
		const harness = createHarness(true)
		await startRecording(harness)
		dispatchPointer(harness.button, 'pointerup')
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
		dispatchPointer(button, 'pointerdown')
		vi.advanceTimersByTime(300)
		engine.resolveStart()
		await Promise.resolve()
		await Promise.resolve()
		dispatchPointer(button, 'pointerup')
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
		dispatchPointer(harness.button, 'pointerup')
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

	test('empty preview does not inject or auto-enter', async () => {
		const harness = createHarness(true)
		await startRecording(harness)
		dispatchPointer(harness.button, 'pointerup')
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
