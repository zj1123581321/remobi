import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

const harness = vi.hoisted(() => ({
	terminals: [] as FakeTerminal[],
	sockets: [] as FakeSocket[],
}))

class FakeTerminal {
	readonly options = { fontSize: 14, theme: undefined as Record<string, string> | undefined }
	readonly buffer = { active: { cursorX: 0, cursorY: 0 } }
	readonly unicode = { activeVersion: '' }
	readonly textarea = document.createElement('textarea')
	readonly writes: string[] = []
	cols = 80
	rows = 24
	private dataHandler: ((data: string) => void) | undefined

	constructor() {
		harness.terminals.push(this)
	}

	loadAddon(): void {}
	open(container: HTMLElement): void {
		const xterm = document.createElement('div')
		xterm.className = 'xterm'
		container.append(xterm)
	}
	fit(): void {}
	onData(handler: (data: string) => void): { dispose(): void } {
		this.dataHandler = handler
		return {
			dispose: () => {
				this.dataHandler = undefined
			},
		}
	}
	reset(): void {
		this.writes.push('<reset>')
	}
	write(data: string, callback?: () => void): void {
		this.writes.push(data)
		callback?.()
	}
	focus(): void {}
	blur(): void {}

	emitInput(data: string): void {
		this.dataHandler?.(data)
	}
}

class FakeSocket extends EventTarget {
	static readonly CONNECTING = 0
	static readonly OPEN = 1
	static readonly CLOSING = 2
	static readonly CLOSED = 3
	static readonly instances: FakeSocket[] = harness.sockets
	readonly url: string
	readonly sent: string[] = []
	readyState = FakeSocket.CONNECTING

	constructor(url: string) {
		super()
		this.url = url
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
		Object.defineProperty(globalThis, '__remobiVersion', { configurable: true, value: 'test' })
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
		const terminal = harness.terminals[0] as FakeTerminal
		terminal.emitInput('dangerous-command\r')
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

	test('isolates old epochs and treats snapshot timeout as a backoff failure', async () => {
		const writesBeforeClose = [...(harness.terminals[0] as FakeTerminal).writes]
		socket.close()
		receive(socket, { type: 'snapshot', data: 'stale', sessionId: 'old', outputWatermark: 0 })
		expect((harness.terminals[0] as FakeTerminal).writes).toEqual(writesBeforeClose)
		await vi.advanceTimersByTimeAsync(1_000)
		const nextSocket = harness.sockets[1] as FakeSocket
		nextSocket.open()
		await vi.advanceTimersByTimeAsync(9_999)
		expect(nextSocket.readyState).toBe(FakeSocket.OPEN)
		await vi.advanceTimersByTimeAsync(1)
		expect(nextSocket.readyState).toBe(FakeSocket.CLOSED)
		expect(window.term?.getConnectionStatus?.()).toMatchObject({
			state: 'reconnecting',
			consecutivePreSyncFailures: 1,
			lastFailureReason: 'snapshot-timeout',
		})
	})
})
