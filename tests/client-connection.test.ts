import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

const harness = vi.hoisted(() => ({
	sockets: [] as FakeSocket[],
	terminal: undefined as FakeTerminal | undefined,
}))

class FakeTerminal {
	readonly options = { fontSize: 14 }
	readonly unicode = { activeVersion: '' }
	readonly writes: string[] = []
	cols = 80
	rows = 24

	constructor() {
		harness.terminal = this
	}

	loadAddon(): void {}
	open(): void {}
	onData(): { dispose(): void } {
		return { dispose() {} }
	}
	reset(): void {
		this.writes.push('<reset>')
	}
	write(data: string, callback?: () => void): void {
		this.writes.push(data)
		callback?.()
	}
}

class FakeSocket extends EventTarget {
	static readonly CONNECTING = 0
	static readonly OPEN = 1
	static readonly CLOSED = 3
	readonly sent: string[] = []
	readyState = FakeSocket.CONNECTING

	constructor() {
		super()
		harness.sockets.push(this)
	}

	send(payload: string): void {
		this.sent.push(payload)
	}
	close(): void {
		if (this.readyState === FakeSocket.CLOSED) return
		this.readyState = FakeSocket.CLOSED
		this.dispatchEvent(new Event('close'))
	}
	open(): void {
		this.readyState = FakeSocket.OPEN
		this.dispatchEvent(new Event('open'))
	}
	receive(data: string): void {
		this.dispatchEvent(new MessageEvent('message', { data }))
	}
}

function receive(socket: FakeSocket, message: Record<string, unknown>): void {
	socket.receive(JSON.stringify(message))
}

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({
	FitAddon: class {
		fit(): void {}
	},
}))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('../src/index', () => ({
	createHookRegistry: () => ({}),
	init: vi.fn(),
}))

describe('client connection state machine', () => {
	let socket: FakeSocket

	beforeAll(async () => {
		vi.useFakeTimers()
		document.body.innerHTML = '<div id="terminal"></div>'
		Object.defineProperty(globalThis, '__remobiConfig', {
			configurable: true,
			value: {
				name: 'test',
				theme: { background: '#000' },
				font: { family: 'monospace', mobileSizeDefault: 13 },
				reconnect: { enabled: false },
			},
		})
		Object.defineProperty(globalThis, '__remobiBasePath', { configurable: true, value: '/' })
		vi.stubGlobal('WebSocket', FakeSocket)
		vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `ping-${harness.sockets.length}`) })
		await import('../src/client-entry')
		socket = harness.sockets[0] as FakeSocket
	})

	afterAll(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	test('drops input while syncing, then emits ping before the coalesced resize after snapshot', () => {
		const terminal = harness.terminal as FakeTerminal
		window.term?.input('dangerous-command\r', true)
		expect(socket.sent).toEqual([])

		socket.open()
		expect(window.term?.isConnected()).toBe(false)
		terminal.cols = 90
		terminal.rows = 30
		window.__remobiResize?.()
		terminal.cols = 100
		terminal.rows = 40
		window.__remobiResize?.()

		receive(socket, { type: 'output', data: 'five', seq: 5 })
		receive(socket, { type: 'output', data: 'four', seq: 4 })
		receive(socket, {
			type: 'snapshot',
			data: 'snapshot',
			sessionId: 'session-1',
			outputWatermark: 3,
		})

		expect(window.term?.isConnected()).toBe(true)
		expect(socket.sent).toHaveLength(2)
		expect(JSON.parse(socket.sent[0] as string)).toMatchObject({ type: 'ping', id: 'ping-1' })
		expect(JSON.parse(socket.sent[1] as string)).toEqual({ type: 'resize', cols: 100, rows: 40 })
		expect(terminal.writes).toEqual(['<reset>', 'snapshot', 'four', 'five'])
	})

	test('only a matching pong schedules the next single ping', async () => {
		const firstPing = JSON.parse(socket.sent[0] as string) as { type: string; id: string }
		socket.receive(JSON.stringify({ type: 'pong', id: 'late-or-wrong' }))
		await vi.advanceTimersByTimeAsync(10_000)
		expect(socket.sent).toHaveLength(2)

		socket.receive(JSON.stringify({ type: 'pong', id: firstPing.id }))
		await vi.advanceTimersByTimeAsync(9_999)
		expect(socket.sent).toHaveLength(2)
		await vi.advanceTimersByTimeAsync(1)
		expect(socket.sent).toHaveLength(3)
		expect(JSON.parse(socket.sent[2] as string).type).toBe('ping')
	})
})
