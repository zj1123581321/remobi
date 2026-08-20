import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import type { ConnectionStatus } from '../src/types'

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

function currentSocket(): FakeSocket {
	const socket = harness.sockets[harness.sockets.length - 1]
	if (!socket) throw new Error('test harness has no socket')
	return socket
}

function getStatus(): ConnectionStatus {
	const status = harness.terminal && window.term?.getConnectionStatus()
	if (!status) throw new Error('test harness has no connection status')
	return status
}

function setVisibility(state: 'hidden' | 'visible'): void {
	Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
}

function pagehideEvent(persisted: boolean): Event {
	const event = new Event('pagehide')
	Object.defineProperty(event, 'persisted', { configurable: true, value: persisted })
	return event
}

async function freshAttempt(): Promise<FakeSocket> {
	setVisibility('hidden')
	document.dispatchEvent(new Event('visibilitychange'))
	setVisibility('visible')
	document.dispatchEvent(new Event('visibilitychange'))
	await vi.advanceTimersByTimeAsync(0)
	return currentSocket()
}

async function freshSynced(snapshot = 'snapshot'): Promise<FakeSocket> {
	const socket = await freshAttempt()
	socket.open()
	receive(socket, {
		type: 'snapshot',
		data: snapshot,
		sessionId: `session-${harness.sockets.length}`,
		outputWatermark: 0,
	})
	return socket
}

async function freshPreSyncAttempt(): Promise<FakeSocket> {
	await freshSynced()
	return freshAttempt()
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

	afterAll(async () => {
		setVisibility('hidden')
		document.dispatchEvent(new Event('visibilitychange'))
		await vi.advanceTimersByTimeAsync(0)
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

	test.each([
		['hidden', 'visibilitychange', false],
		['pagehide', 'pagehide', false],
		['pagehide-persisted', 'pagehide', true],
	] as const)('%s suspends a synced socket and clears timers', async (_name, event, persisted) => {
		const oldSocket = await freshSynced()
		const socketCount = harness.sockets.length
		if (event === 'visibilitychange') {
			setVisibility('hidden')
			document.dispatchEvent(new Event('visibilitychange'))
		} else {
			window.dispatchEvent(pagehideEvent(persisted))
		}

		expect(oldSocket.readyState).toBe(FakeSocket.CLOSED)
		expect(getStatus().state).toBe('disconnected')
		await vi.advanceTimersByTimeAsync(20_000)
		expect(harness.sockets).toHaveLength(socketCount)
	})

	test('visible replaces an OPEN socket and isolates its later events', async () => {
		const oldSocket = await freshSynced()
		const terminal = harness.terminal as FakeTerminal
		const writesBefore = terminal.writes.length
		const socketCount = harness.sockets.length
		setVisibility('visible')
		document.dispatchEvent(new Event('visibilitychange'))
		await vi.advanceTimersByTimeAsync(0)

		const newSocket = currentSocket()
		expect(harness.sockets).toHaveLength(socketCount + 1)
		expect(newSocket).not.toBe(oldSocket)
		expect(oldSocket.readyState).toBe(FakeSocket.CLOSED)
		expect(getStatus().state).toBe('reconnecting')
		oldSocket.open()
		receive(oldSocket, {
			type: 'snapshot',
			data: 'stale',
			sessionId: 'stale-session',
			outputWatermark: 0,
		})
		receive(oldSocket, { type: 'output', data: 'stale-output', seq: 1 })
		expect(terminal.writes).toHaveLength(writesBefore)
		expect(getStatus().state).toBe('reconnecting')
	})

	test('pageshow creates a new epoch after the old socket is closed', async () => {
		const oldSocket = await freshSynced()
		const socketCount = harness.sockets.length
		setVisibility('hidden')
		document.dispatchEvent(new Event('visibilitychange'))
		setVisibility('visible')
		window.dispatchEvent(new Event('pageshow'))
		await vi.advanceTimersByTimeAsync(0)

		expect(harness.sockets).toHaveLength(socketCount + 1)
		expect(currentSocket()).not.toBe(oldSocket)
		expect(getStatus().state).toBe('reconnecting')
	})

	test('visibility, online, and pageshow in one turn create one socket', async () => {
		await freshSynced()
		setVisibility('hidden')
		document.dispatchEvent(new Event('visibilitychange'))
		const socketCount = harness.sockets.length
		setVisibility('visible')
		document.dispatchEvent(new Event('visibilitychange'))
		window.dispatchEvent(new Event('online'))
		window.dispatchEvent(new Event('pageshow'))
		await vi.advanceTimersByTimeAsync(0)
		expect(harness.sockets).toHaveLength(socketCount + 1)
})

	test('online while visible retries a disconnected page immediately', async () => {
		await freshSynced()
		currentSocket().close()
		const socketCount = harness.sockets.length
		window.dispatchEvent(new Event('online'))
		await vi.advanceTimersByTimeAsync(0)
		expect(harness.sockets).toHaveLength(socketCount + 1)
})

	test('online while hidden does not create a socket', async () => {
		await freshSynced()
		setVisibility('hidden')
		document.dispatchEvent(new Event('visibilitychange'))
		const socketCount = harness.sockets.length
		window.dispatchEvent(new Event('online'))
		await vi.advanceTimersByTimeAsync(20_000)
		expect(harness.sockets).toHaveLength(socketCount)
	})

	test.each(['snapshot', 'output'] as const)('old epoch %s is discarded', async (kind) => {
		const oldSocket = await freshSynced()
		const terminal = harness.terminal as FakeTerminal
		const writesBefore = terminal.writes.length
		setVisibility('visible')
		document.dispatchEvent(new Event('visibilitychange'))
		await vi.advanceTimersByTimeAsync(0)
		if (kind === 'snapshot') {
			receive(oldSocket, {
				type: 'snapshot',
				data: 'old snapshot',
				sessionId: 'old-session',
				outputWatermark: 0,
			})
		} else {
			receive(oldSocket, { type: 'output', data: 'old output', seq: 1 })
		}
		expect(terminal.writes).toHaveLength(writesBefore)
		expect(getStatus().state).toBe('reconnecting')
	})

	test('old epoch pong does not renew the current heartbeat deadline', async () => {
		const oldSocket = await freshSynced()
		const oldPing = JSON.parse(oldSocket.sent[0] as string) as { id: string }
		setVisibility('visible')
		document.dispatchEvent(new Event('visibilitychange'))
		await vi.advanceTimersByTimeAsync(0)
		const newSocket = currentSocket()
		newSocket.open()
		receive(newSocket, {
			type: 'snapshot',
			data: 'new snapshot',
			sessionId: 'new-session',
			outputWatermark: 0,
		})
		oldSocket.receive(JSON.stringify({ type: 'pong', id: oldPing.id }))
		await vi.advanceTimersByTimeAsync(14_999)
		expect(newSocket.readyState).toBe(FakeSocket.OPEN)
		await vi.advanceTimersByTimeAsync(1)
		expect(newSocket.readyState).toBe(FakeSocket.CLOSED)
	})

	test('old epoch close and error do not count or schedule a failure', async () => {
		const oldSocket = await freshSynced()
		setVisibility('visible')
		document.dispatchEvent(new Event('visibilitychange'))
		await vi.advanceTimersByTimeAsync(0)
		const socketCount = harness.sockets.length
		oldSocket.dispatchEvent(new Event('error'))
		oldSocket.dispatchEvent(new Event('close'))
		await vi.advanceTimersByTimeAsync(0)
		expect(getStatus().consecutivePreSyncFailures).toBe(0)
		expect(harness.sockets).toHaveLength(socketCount)
	})

	test('old epoch open is ignored and cannot enter syncing', async () => {
		const oldSocket = await freshAttempt()
		setVisibility('visible')
		document.dispatchEvent(new Event('visibilitychange'))
		await vi.advanceTimersByTimeAsync(0)
		oldSocket.open()
		expect(getStatus().state).toBe('reconnecting')
	})

	test.each([
		[1, 1_000],
		[2, 2_000],
		[3, 4_000],
		[4, 8_000],
		[5, 15_000],
		[6, 15_000],
	] as const)('failure #%i schedules the next attempt after %ims', async (failureNumber, delay) => {
		await freshSynced()
		await freshAttempt()
		const backoffs = [1_000, 2_000, 4_000, 8_000, 15_000]
		for (let index = 0; index < failureNumber; index += 1) {
			const countBeforeFailure = harness.sockets.length
			currentSocket().close()
			expect(getStatus().consecutivePreSyncFailures).toBe(index + 1)
			if (index < failureNumber - 1) {
				await vi.advanceTimersByTimeAsync(backoffs[index] as number)
				expect(harness.sockets).toHaveLength(countBeforeFailure + 1)
			}
		}
		const countBeforeDelay = harness.sockets.length
		await vi.advanceTimersByTimeAsync(delay - 1)
		expect(harness.sockets).toHaveLength(countBeforeDelay)
		await vi.advanceTimersByTimeAsync(1)
		expect(harness.sockets).toHaveLength(countBeforeDelay + 1)
	})

	test('an open socket without a snapshot times out as one pre-sync failure', async () => {
		const socket = await freshPreSyncAttempt()
		socket.open()
		await vi.advanceTimersByTimeAsync(9_999)
		expect(socket.readyState).toBe(FakeSocket.OPEN)
		await vi.advanceTimersByTimeAsync(1)
		expect(socket.readyState).toBe(FakeSocket.CLOSED)
		expect(getStatus().consecutivePreSyncFailures).toBe(1)
		expect(getStatus().lastFailureReason).toBe('snapshot-timeout')
	})

	test('a snapshot clears failures and restores the one-second backoff', async () => {
		await freshSynced()
		currentSocket().close()
		await vi.advanceTimersByTimeAsync(1_000)
		const socket = currentSocket()
		socket.open()
		receive(socket, {
			type: 'snapshot',
			data: 'recovered',
			sessionId: 'recovered-session',
			outputWatermark: 0,
		})
		expect(getStatus()).toEqual({
			state: 'synced',
			consecutivePreSyncFailures: 0,
			lastFailureReason: null,
		})
		const countBeforeFailure = harness.sockets.length
		socket.close()
		await vi.advanceTimersByTimeAsync(999)
		expect(harness.sockets).toHaveLength(countBeforeFailure)
		await vi.advanceTimersByTimeAsync(1)
		expect(harness.sockets).toHaveLength(countBeforeFailure + 1)
	})

	test('hidden clears a pending reconnect timer until visible', async () => {
		await freshSynced()
		currentSocket().close()
		const socketCount = harness.sockets.length
		setVisibility('hidden')
		document.dispatchEvent(new Event('visibilitychange'))
		await vi.advanceTimersByTimeAsync(15_000)
		expect(harness.sockets).toHaveLength(socketCount)
		setVisibility('visible')
		document.dispatchEvent(new Event('visibilitychange'))
		await vi.advanceTimersByTimeAsync(0)
		expect(harness.sockets).toHaveLength(socketCount + 1)
	})

	test('manual retry is immediate and preserves the failure count', async () => {
		await freshSynced()
		await freshAttempt()
		currentSocket().close()
		const socketCount = harness.sockets.length
		window.term?.requestReconnect()
		await vi.advanceTimersByTimeAsync(0)
		expect(harness.sockets).toHaveLength(socketCount + 1)
		expect(getStatus().consecutivePreSyncFailures).toBe(1)
		await vi.advanceTimersByTimeAsync(1_000)
		expect(harness.sockets).toHaveLength(socketCount + 1)
	})

	test.each([
		[3, ['four', 'five']],
		[5, []],
	] as const)('snapshot watermark %i filters buffered seq values', async (watermark, expected) => {
		const terminal = harness.terminal as FakeTerminal
		const writesBefore = terminal.writes.length
		const socket = await freshAttempt()
		socket.open()
		for (let seq = 1; seq <= 5; seq += 1) {
			receive(socket, { type: 'output', data: ['one', 'two', 'three', 'four', 'five'][seq - 1], seq })
		}
		receive(socket, {
			type: 'snapshot',
			data: 'watermarked',
			sessionId: `watermark-${watermark}`,
			outputWatermark: watermark,
		})
		expect(terminal.writes.slice(writesBefore)).toEqual(['<reset>', 'watermarked', ...expected])
	})

	test('buffered output arriving out of order is applied by seq', async () => {
		const terminal = harness.terminal as FakeTerminal
		const writesBefore = terminal.writes.length
		const socket = await freshAttempt()
		socket.open()
		receive(socket, { type: 'output', data: 'five', seq: 5 })
		receive(socket, { type: 'output', data: 'four', seq: 4 })
		receive(socket, {
			type: 'snapshot',
			data: 'ordered',
			sessionId: 'ordered-session',
			outputWatermark: 0,
		})
		expect(terminal.writes.slice(writesBefore)).toEqual(['<reset>', 'ordered', 'four', 'five'])
	})

	test('pre-snapshot output over one MiB closes the socket and retries', async () => {
		const socket = await freshPreSyncAttempt()
		socket.open()
		let notice = ''
		const onNotice = (event: Event): void => {
			if (event instanceof CustomEvent && typeof event.detail === 'string') notice = event.detail
		}
		window.addEventListener('remobi-connection-notice', onNotice)
		receive(socket, { type: 'output', data: '🙂'.repeat(262_145), seq: 1 })
		window.removeEventListener('remobi-connection-notice', onNotice)
		expect(socket.readyState).toBe(FakeSocket.CLOSED)
		expect(getStatus().lastFailureReason).toBe('output-overflow')
		expect(notice).toBe('Output too fast — resyncing.')
		const socketCount = harness.sockets.length
		await vi.advanceTimersByTimeAsync(999)
		expect(harness.sockets).toHaveLength(socketCount)
		await vi.advanceTimersByTimeAsync(1)
		expect(harness.sockets).toHaveLength(socketCount + 1)
	})

	test('malformed server frames are protocol errors rather than silent drops', async () => {
		const socket = await freshPreSyncAttempt()
		socket.open()
		socket.receive('{not-json')
		expect(socket.readyState).toBe(FakeSocket.CLOSED)
		expect(getStatus().lastFailureReason).toBe('protocol-error')
		expect(getStatus().consecutivePreSyncFailures).toBe(1)
	})

	test('exit stops automatic reconnect and reports the session-ended action', async () => {
		const socket = await freshSynced()
		const socketCount = harness.sockets.length
		let notice = ''
		const onNotice = (event: Event): void => {
			if (event instanceof CustomEvent && typeof event.detail === 'string') notice = event.detail
		}
		window.addEventListener('remobi-connection-notice', onNotice)
		receive(socket, { type: 'exit', exitCode: 0, signal: null })
		socket.close()
		await vi.advanceTimersByTimeAsync(20_000)
		window.removeEventListener('remobi-connection-notice', onNotice)
		expect(getStatus().state).toBe('disconnected')
		expect(notice).toBe('Session ended — restart remobi to start a new one.')
		expect(harness.sockets).toHaveLength(socketCount)
	})

	test('retrying an ended session and receiving exit again stops again', async () => {
		const socket = await freshSynced()
		receive(socket, { type: 'exit', exitCode: 0, signal: null })
		socket.close()
		const socketCount = harness.sockets.length
		window.term?.requestReconnect()
		await vi.advanceTimersByTimeAsync(0)
		expect(harness.sockets).toHaveLength(socketCount + 1)
		const retrySocket = currentSocket()
		receive(retrySocket, { type: 'exit', exitCode: 0, signal: null })
		retrySocket.close()
		await vi.advanceTimersByTimeAsync(20_000)
		expect(harness.sockets).toHaveLength(socketCount + 1)
		expect(getStatus().state).toBe('disconnected')
	})

	test('retrying an ended session can recover after a new snapshot', async () => {
		const socket = await freshSynced()
		receive(socket, { type: 'exit', exitCode: 0, signal: null })
		socket.close()
		window.term?.requestReconnect()
		await vi.advanceTimersByTimeAsync(0)
		const retrySocket = currentSocket()
		retrySocket.open()
		receive(retrySocket, {
			type: 'snapshot',
			data: 'new session',
			sessionId: 'new-session-after-exit',
			outputWatermark: 0,
		})
		expect(getStatus()).toEqual({
			state: 'synced',
			consecutivePreSyncFailures: 0,
			lastFailureReason: null,
		})
	})
})
