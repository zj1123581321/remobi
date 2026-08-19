import { describe, expect, test } from 'vitest'
import WebSocket from 'ws'
import { DoubaoEngine } from '../src/asr/doubao/engine'
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

function websocketFactory(url: string): WebSocket {
	return new WebSocket(url)
}

describe('DoubaoEngine', () => {
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
})
