import { describe, expect, test, vi } from 'vitest'
import WebSocket from 'ws'
import { DoubaoEngine, type WebSocketLike } from '../src/asr/doubao/engine'
import { createMockVolcServer } from './fixtures/asr/mock-volc-server'

class FakeCapture {
	private callback: ((samples: Int16Array) => void) | undefined
	started = false
	stopped = false

	async start(callback: (samples: Int16Array) => void): Promise<void> {
		this.callback = callback
		this.started = true
	}

	async stop(): Promise<void> {
		this.stopped = true
	}

	push(samples: Int16Array): void {
		this.callback?.(samples)
	}
}

function websocketFactory(url: string): WebSocketLike {
	return new WebSocketAdapter(new WebSocket(url))
}

class WebSocketAdapter implements WebSocketLike {
	private readonly socket: WebSocket

	constructor(socket: WebSocket) {
		this.socket = socket
	}

	get readyState(): number {
		return this.socket.readyState
	}

	get bufferedAmount(): number {
		return this.socket.bufferedAmount
	}

	set onopen(handler: (() => void) | null) {
		this.socket.onopen = handler === null ? null : () => handler()
	}

	set onerror(handler: ((event: { readonly message?: string }) => void) | null) {
		this.socket.onerror = handler === null ? null : (event) => handler({ message: event.message })
	}

	set onclose(
		handler: ((event: { readonly code: number; readonly reason: string }) => void) | null,
	) {
		this.socket.onclose = handler === null ? null : (event) => handler({ code: event.code, reason: event.reason })
	}

	set onmessage(handler: ((event: { readonly data: unknown }) => void) | null) {
		this.socket.onmessage = handler === null ? null : (event) => handler({ data: event.data })
	}

	send(data: Uint8Array): void {
		this.socket.send(data)
	}

	close(): void {
		this.socket.close()
	}
}

class SlowSocket implements WebSocketLike {
	readonly url: string
	readonly readyState = 1
	readonly bufferedAmount = 64_001
	onopen: (() => void) | null = null
	onerror: ((event: { readonly message?: string }) => void) | null = null
	onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null = null
	onmessage: ((event: { readonly data: unknown }) => void) | null = null

	constructor(url: string) {
		this.url = url
		queueMicrotask(() => this.onopen?.())
	}

	send(_data: Uint8Array): void {}

	close(): void {}
}

class RuntimeErrorSocket extends SlowSocket {
	triggerError(): void {
		this.onerror?.({ message: 'runtime failure' })
	}
}

class FailingCapture {
	readonly error: unknown

	constructor(error: unknown) {
		this.error = error
	}

	async start(_callback: (samples: Int16Array) => void): Promise<void> {
		throw this.error
	}

	async stop(): Promise<void> {}
}

function namedError(name: string): Error {
	const error = new Error(name)
	error.name = name
	return error
}

function serverResponse(json: unknown, final = false): ArrayBuffer {
	const payload = new TextEncoder().encode(JSON.stringify(json))
	const payloadOffset = final ? 12 : 8
	const bytes = new Uint8Array(payloadOffset + payload.byteLength)
	bytes.set([0x11, final ? 0x93 : 0x90, 0x10, 0])
	const view = new DataView(bytes.buffer)
	if (final) view.setInt32(4, 1)
	view.setUint32(final ? 8 : 4, payload.byteLength)
	bytes.set(payload, payloadOffset)
	return bytes.buffer
}

describe('DoubaoEngine', () => {
	test('requires websocket support even when capture is injected', () => {
		vi.stubGlobal('WebSocket', undefined)
		try {
			const engine = new DoubaoEngine({
				apiKey: 'test-api-key',
				resourceId: 'volc.seedasr.sauc.duration',
				capture: new FakeCapture(),
			})
			expect(engine.isSupported()).toBe(false)
		} finally {
			vi.unstubAllGlobals()
		}
	})

	test('streams injected PCM through mock server and exposes partial/final events', async () => {
		const server = await createMockVolcServer({ partialEvery: 1 })
		const capture = new FakeCapture()
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			endpoint: server.endpoint,
			websocketFactory: websocketFactory,
			capture,
		})
		const partials: string[] = []
		const finals: string[] = []
		const errors: string[] = []
		engine.onPartial((text) => partials.push(text))
		engine.onFinal((text) => finals.push(text))
		engine.onError((error) => errors.push(error))

		await engine.start()
		capture.push(new Int16Array(1600))
		await new Promise((resolve) => setTimeout(resolve, 20))
		await engine.stop()

		expect(capture.started).toBe(true)
		expect(capture.stopped).toBe(true)
		expect(partials).toContain('mock partial')
		expect(finals).toEqual(['mock final'])
		expect(errors).toEqual([])
		expect(server.received.map((frame) => (frame[1] ?? 0) >> 4)).toEqual([1, 2, 2])
		await server.close()
	})

	test('maps a provider error frame to provider-error', async () => {
		const server = await createMockVolcServer({ errorCode: 45000151 })
		const capture = new FakeCapture()
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			endpoint: server.endpoint,
			websocketFactory: websocketFactory,
			capture,
		})
		const errors: string[] = []
		engine.onError((error) => errors.push(error))
		await engine.start()
		capture.push(new Int16Array(1600))
		await new Promise((resolve) => setTimeout(resolve, 10))
		await engine.stop()
		expect(errors).toContain('provider-error')
		await server.close()
	})

	test('rejects an unauthorised query before websocket open', async () => {
		const server = await createMockVolcServer()
		const capture = new FakeCapture()
		const engine = new DoubaoEngine({
			apiKey: 'wrong',
			resourceId: 'volc.seedasr.sauc.duration',
			endpoint: server.endpoint,
			websocketFactory: websocketFactory,
			capture,
		})
		const errors: string[] = []
		engine.onError((error) => errors.push(error))
		await expect(engine.start()).rejects.toThrow()
		expect(errors).toContain('connection-failed')
		await server.close()
	})

	test('reports network-too-slow above the two-second in-flight high water mark', async () => {
		const capture = new FakeCapture()
		const socket = new SlowSocket('')
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			websocketFactory: () => socket,
			capture,
		})
		const errors: string[] = []
		engine.onError((error) => errors.push(error))
		await engine.start()
		await new Promise((resolve) => setTimeout(resolve, 120))
		expect(errors).toContain('network-too-slow')
		expect(capture.stopped).toBe(true)
	})

	test('keeps the runtime websocket error handler after opening', async () => {
		const capture = new FakeCapture()
		const socket = new RuntimeErrorSocket('')
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			websocketFactory: () => socket,
			capture,
		})
		const errors: string[] = []
		engine.onError((error) => errors.push(error))

		await engine.start()
		socket.triggerError()
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(errors).toEqual(['connection-failed'])
		expect(capture.stopped).toBe(true)
	})

	test.each([
		[new DOMException('unsupported', 'NotSupportedError'), 'audio-context'],
		[namedError('NotSupportedError'), 'audio-context'],
		[namedError('UnsupportedSampleRateError'), 'unsupported-sample-rate'],
		[namedError('WorkletLoadError'), 'worklet-load-failed'],
	] as const)('maps capture failure %s to %s', async (error, expected) => {
		const socket = new SlowSocket('')
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			websocketFactory: () => socket,
			capture: new FailingCapture(error),
		})
		const errors: string[] = []
		engine.onError((code) => errors.push(code))

		await expect(engine.start()).rejects.toBe(error)
		expect(errors).toEqual([expected])
	})

	test('extracts only the known provider result structure', async () => {
		const socket = new SlowSocket('')
		const capture = new FakeCapture()
		const engine = new DoubaoEngine({
			apiKey: 'test-api-key',
			resourceId: 'volc.seedasr.sauc.duration',
			websocketFactory: () => socket,
			capture,
		})
		const partials: string[] = []
		const finals: string[] = []
		engine.onPartial((text) => partials.push(text))
		engine.onFinal((text) => finals.push(text))

		await engine.start()
			socket.onmessage?.({
			data: serverResponse({
				result: {
					utterances: [{ text: 'hello' }, { nested: { text: 'must not recurse' } }],
				},
				deep: { result: { text: 'must not recurse' } },
			}),
		})
		const stopping = engine.stop()
		await new Promise((resolve) => setTimeout(resolve, 0))
		socket.onmessage?.({ data: serverResponse({ result: { text: 'done' } }, true) })
		await stopping

		expect(partials).toEqual(['hello'])
		expect(finals).toEqual(['done'])
	})
})
