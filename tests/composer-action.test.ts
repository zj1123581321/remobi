import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AsrEngine, AsrErrorHandler, AsrFinalHandler, AsrTextHandler } from '../src/asr/types'
import { defineConfig } from '../src/config'
import { createMicController } from '../src/controls/mic-controller'
import { createHookRegistry } from '../src/hooks/registry'
import type { ConnectionStatus, InputActionResult, XTerminal } from '../src/types'
import { _resetTouchGuard } from '../src/util/tap'

class IdleEngine implements AsrEngine {
	start(): Promise<void> {
		return Promise.resolve()
	}

	stop(): Promise<void> {
		return Promise.resolve()
	}

	isSupported(): boolean {
		return true
	}

	onPartial(_handler: AsrTextHandler): () => void {
		return () => {}
	}

	onFinal(_handler: AsrFinalHandler): () => void {
		return () => {}
	}

	onError(_handler: AsrErrorHandler): () => void {
		return () => {}
	}
}

type SentAction = { readonly id: string; readonly data: string }

class ControlledTerminal implements XTerminal {
	readonly options = { fontSize: 14 }
	readonly sent: SentAction[] = []
	private status: ConnectionStatus = {
		state: 'synced',
		consecutivePreSyncFailures: 0,
		lastFailureReason: null,
	}
	private sessionId = 'session-1'
	private readonly connectionListeners = new Set<(connected: boolean) => void>()
	private readonly statusListeners = new Set<(status: ConnectionStatus) => void>()
	private readonly resultListeners = new Set<(result: InputActionResult) => void>()

	input(_data: string, _wasUserInput: boolean): void {}

	focus(): void {}

	onData(_handler: (data: string) => void): { dispose(): void } {
		return { dispose() {} }
	}

	isConnected(): boolean {
		return this.status.state === 'synced'
	}

	onConnectionChange(handler: (connected: boolean) => void): { dispose(): void } {
		this.connectionListeners.add(handler)
		handler(this.isConnected())
		return { dispose: () => this.connectionListeners.delete(handler) }
	}

	getConnectionStatus(): ConnectionStatus {
		return this.status
	}

	onConnectionStatusChange(handler: (status: ConnectionStatus) => void): { dispose(): void } {
		this.statusListeners.add(handler)
		handler(this.status)
		return { dispose: () => this.statusListeners.delete(handler) }
	}

	requestReconnect(): void {}

	getSessionId(): string | null {
		return this.isConnected() ? this.sessionId : null
	}

	sendInputAction(id: string, data: string): boolean {
		if (!this.isConnected()) return false
		this.sent.push({ id, data })
		return true
	}

	onInputActionResult(handler: (result: InputActionResult) => void): { dispose(): void } {
		this.resultListeners.add(handler)
		return { dispose: () => this.resultListeners.delete(handler) }
	}

	setConnection(state: ConnectionStatus['state'], sessionId = this.sessionId): void {
		const wasConnected = this.isConnected()
		this.sessionId = sessionId
		this.status = { state, consecutivePreSyncFailures: 0, lastFailureReason: null }
		for (const handler of this.statusListeners) handler(this.status)
		if (wasConnected !== this.isConnected()) {
			for (const handler of this.connectionListeners) handler(this.isConnected())
		}
	}

	emitResult(result: InputActionResult): void {
		for (const handler of this.resultListeners) handler(result)
	}
}

function createHarness(
	autoEnter = false,
	hooks = createHookRegistry(),
): {
	readonly term: ControlledTerminal
	readonly composer: NonNullable<ReturnType<typeof createMicController>>
	readonly composerButton: HTMLButtonElement
} {
	const term = new ControlledTerminal()
	const composer = createMicController({
		term,
		config: defineConfig({
			asr: { enabled: true, autoEnter, doubao: { apiKey: 'test-key' } },
		}),
		hooks,
		engine: new IdleEngine(),
	})
	if (!composer) throw new Error('expected composer')
	const composerButton = document.createElement('button')
	composer.attachComposerToggle(composerButton)
	document.body.append(composerButton)
	composerButton.click()
	return { term, composer, composerButton }
}

function send(composer: NonNullable<ReturnType<typeof createMicController>>, text: string): void {
	composer.preview.input.value = text
	composer.preview.input.dispatchEvent(new Event('input', { bubbles: true }))
	composer.preview.element.querySelector<HTMLButtonElement>('.wt-composer-send')?.click()
}

async function flush(): Promise<void> {
	for (let index = 0; index < 8; index++) await Promise.resolve()
}

beforeEach(() => {
	GlobalRegistrator.register()
	localStorage.clear()
	vi.useFakeTimers()
	vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'action-1') })
})

afterEach(() => {
	_resetTouchGuard()
	localStorage.clear()
	vi.useRealTimers()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
	GlobalRegistrator.unregister()
})

describe('composer input-action contract', () => {
	test.each([
		{ autoEnter: false, data: 'hello' },
		{ autoEnter: true, data: 'hello\r' },
	])('persists pending before sending one action ($autoEnter)', async ({ autoEnter, data }) => {
		const harness = createHarness(autoEnter)
		let pendingAtSend: unknown
		const originalSend = harness.term.sendInputAction.bind(harness.term)
		vi.spyOn(harness.term, 'sendInputAction').mockImplementation((id, actionData) => {
			pendingAtSend = JSON.parse(localStorage.getItem('remobi:composer:v1:/') ?? '{}').pending
			return originalSend(id, actionData)
		})

		send(harness.composer, 'hello')
		await flush()

		const stored = JSON.parse(localStorage.getItem('remobi:composer:v1:/') ?? '{}')
		expect(pendingAtSend).toEqual(stored.pending)
		expect(stored.pending).toEqual({
			id: 'action-1',
			sessionId: 'session-1',
			sourceText: 'hello',
			data,
			status: 'pending',
		})
		expect(harness.term.sent).toEqual([{ id: 'action-1', data }])
		harness.composer.dispose()
	})

	test('accepted clears pending and unchanged draft', async () => {
		const harness = createHarness()
		send(harness.composer, 'hello')
		await flush()
		harness.term.emitResult({ id: 'action-1', accepted: true, reason: null })

		expect(JSON.parse(localStorage.getItem('remobi:composer:v1:/') ?? '{}')).toMatchObject({
			draft: '',
			pending: null,
		})
		expect(harness.composer.preview.getText()).toBe('')
		expect(harness.composer.preview.message.textContent).toBe('Received by terminal.')
		expect(harness.composer.preview.element.querySelector('.wt-composer-send')).toMatchObject({
			disabled: false,
		})
		harness.composer.dispose()
	})

	test('accepted preserves a draft edited while waiting', async () => {
		const harness = createHarness()
		send(harness.composer, 'original')
		await flush()
		harness.composer.preview.input.value = 'new draft'
		harness.composer.preview.input.dispatchEvent(new Event('input', { bubbles: true }))
		harness.term.emitResult({ id: 'action-1', accepted: true, reason: null })

		expect(harness.composer.preview.getText()).toBe('new draft')
		expect(JSON.parse(localStorage.getItem('remobi:composer:v1:/') ?? '{}')).toMatchObject({
			draft: 'new draft',
			pending: null,
		})
		harness.composer.dispose()
	})

	test.each([
		['id-conflict', 'Not received: duplicate submission id.'],
		['session-unavailable', 'Not received: terminal session unavailable.'],
	] as const)('rejected %s is terminal and only offers abandon', async (reason, message) => {
		const harness = createHarness()
		send(harness.composer, 'hello')
		await flush()
		harness.term.emitResult({ id: 'action-1', accepted: false, reason })

		const retry =
			harness.composer.preview.element.querySelector<HTMLButtonElement>('.wt-composer-retry')
		const abandon =
			harness.composer.preview.element.querySelector<HTMLButtonElement>('.wt-composer-abandon')
		expect(harness.composer.preview.message.textContent).toBe(message)
		expect(retry?.hidden).toBe(true)
		expect(retry?.disabled).toBe(true)
		expect(abandon?.hidden).toBe(false)
		retry?.click()
		expect(harness.term.sent).toHaveLength(1)
		abandon?.click()
		expect(JSON.parse(localStorage.getItem('remobi:composer:v1:/') ?? '{}').pending).toBeNull()
		expect(harness.composer.preview.message.textContent).toBe('Removed from this device.')
		harness.composer.dispose()
	})

	test('deadline makes result unknown and explicit retry reuses id and data', async () => {
		const harness = createHarness()
		send(harness.composer, 'hello')
		await flush()
		vi.advanceTimersByTime(15_000)

		expect(harness.composer.preview.message.textContent).toBe(
			'Result unknown — the terminal may or may not have received it.',
		)
		expect(
			harness.composer.preview.element.querySelector<HTMLButtonElement>('.wt-composer-retry'),
		).toMatchObject({ hidden: false, disabled: false })
		harness.composer.preview.element.querySelector<HTMLButtonElement>('.wt-composer-retry')?.click()
		await flush()
		expect(harness.term.sent).toEqual([
			{ id: 'action-1', data: 'hello' },
			{ id: 'action-1', data: 'hello' },
		])
		harness.composer.dispose()
	})

	test('closing preserves pending, while explicit abandon removes only local pending', async () => {
		const harness = createHarness()
		send(harness.composer, 'hello')
		await flush()
		vi.spyOn(window, 'confirm').mockReturnValue(false)
		harness.composer.preview.element
			.querySelector<HTMLButtonElement>('.wt-asr-composer-close')
			?.click()
		expect(JSON.parse(localStorage.getItem('remobi:composer:v1:/') ?? '{}').pending).not.toBeNull()
		expect(harness.composer.preview.isOpen()).toBe(false)
		vi.advanceTimersByTime(15_000)
		harness.composer.preview.element
			.querySelector<HTMLButtonElement>('.wt-composer-abandon')
			?.click()
		expect(JSON.parse(localStorage.getItem('remobi:composer:v1:/') ?? '{}').pending).toBeNull()
		harness.composer.dispose()
	})
})

describe('composer action reconnect rules', () => {
	test('same session resends once per synced epoch without hooks', async () => {
		const hooks = createHookRegistry()
		const before = vi.fn()
		const after = vi.fn()
		hooks.on('beforeSendData', before)
		hooks.on('afterSendData', after)
		const harness = createHarness(false, hooks)
		send(harness.composer, 'hello')
		await flush()
		harness.term.setConnection('syncing')
		harness.term.setConnection('synced', 'session-1')
		harness.term.setConnection('synced', 'session-1')

		expect(harness.term.sent).toEqual([
			{ id: 'action-1', data: 'hello' },
			{ id: 'action-1', data: 'hello' },
		])
		expect(before).toHaveBeenCalledTimes(1)
		expect(after).toHaveBeenCalledTimes(1)
		harness.composer.dispose()
	})

	test('session change marks pending unknown and never auto resends', async () => {
		const harness = createHarness()
		send(harness.composer, 'hello')
		await flush()
		harness.term.setConnection('syncing')
		harness.term.setConnection('synced', 'session-2')

		expect(harness.term.sent).toEqual([{ id: 'action-1', data: 'hello' }])
		expect(harness.composer.preview.message.textContent).toBe(
			'Terminal session changed — last result unknown.',
		)
		expect(JSON.parse(localStorage.getItem('remobi:composer:v1:/') ?? '{}').pending).toMatchObject({
			status: 'unknown',
		})
		harness.composer.dispose()
	})
})
