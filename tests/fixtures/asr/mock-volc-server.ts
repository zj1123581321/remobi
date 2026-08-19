import { createServer, type IncomingMessage, type Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'

const OPEN = 1

export interface MockVolcServerOptions {
	readonly apiKey?: string
	readonly resourceId?: string
	readonly partialEvery?: number
	readonly partialText?: string
	readonly finalText?: string
	readonly errorCode?: number
	readonly malformedFrame?: Uint8Array
	readonly disconnectAfterAudio?: number
}

export interface MockVolcServer {
	readonly endpoint: string
	readonly received: readonly Uint8Array[]
	close(): Promise<void>
}

function readUint32(bytes: Uint8Array, offset: number): number {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset)
}

function readInt32(bytes: Uint8Array, offset: number): number {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset)
}

function parseFrame(data: Uint8Array): { readonly type: number; readonly flags: number; readonly sequence?: number } {
	if (data.byteLength < 8 || data[0] !== 0x11 || data[2] !== 0x10 || data[3] !== 0) {
		throw new Error('mock received malformed SAUC header')
	}
	const messageByte = data[1]
	if (messageByte === undefined) throw new Error('mock received missing SAUC message type')
	const type = messageByte >> 4
	const flags = messageByte & 0x0f
	const sequence = flags === 3 ? readInt32(data, 4) : undefined
	const lengthOffset = type === 0x2 && flags === 3 ? 8 : 4
	const payloadOffset = lengthOffset + 4
	if (readUint32(data, lengthOffset) !== data.byteLength - payloadOffset) {
		throw new Error('mock received invalid SAUC length')
	}
	return sequence === undefined ? { type, flags } : { type, flags, sequence }
}

function jsonFrame(flags: number, sequence: number | undefined, value: unknown): Uint8Array {
	const payload = new TextEncoder().encode(JSON.stringify(value))
	const sequenceBytes = sequence === undefined ? 0 : 4
	const result = new Uint8Array(8 + sequenceBytes + payload.byteLength)
	result.set([0x11, 0x90 | flags, 0x10, 0], 0)
	if (sequence !== undefined) new DataView(result.buffer).setInt32(4, sequence)
	new DataView(result.buffer).setUint32(4 + sequenceBytes, payload.byteLength)
	result.set(payload, 8 + sequenceBytes)
	return result
}

function errorFrame(code: number, value: unknown): Uint8Array {
	const payload = new TextEncoder().encode(JSON.stringify(value))
	const result = new Uint8Array(12 + payload.byteLength)
	result.set([0x11, 0xf0, 0x10, 0], 0)
	new DataView(result.buffer).setUint32(4, code)
	new DataView(result.buffer).setUint32(8, payload.byteLength)
	result.set(payload, 12)
	return result
}

function rejectUpgrade(socket: import('node:stream').Duplex, status: number): void {
	socket.write(`HTTP/1.1 ${status} Unauthorized\r\nConnection: close\r\n\r\n`)
	socket.destroy()
}

/** Small fixture-driven SAUC endpoint; its wire encoder/parser is intentionally independent. */
export async function createMockVolcServer(
	options: MockVolcServerOptions = {},
): Promise<MockVolcServer> {
	const apiKey = options.apiKey ?? 'test-api-key'
	const resourceId = options.resourceId ?? 'volc.seedasr.sauc.duration'
	const partialEvery = options.partialEvery ?? 1
	const received: Uint8Array[] = []
	const sockets = new Set<WebSocket>()
	const wss = new WebSocketServer({ noServer: true })
	const server: Server = createServer()

	server.on('upgrade', (request: IncomingMessage, socket, head) => {
		const url = new URL(request.url ?? '/', 'http://localhost')
		if (url.searchParams.get('api_key') !== apiKey || url.searchParams.get('api_resource_id') !== resourceId) {
			rejectUpgrade(socket, 401)
			return
		}
		wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, request))
	})

	wss.on('connection', (socket) => {
		sockets.add(socket)
		let audioCount = 0
		socket.on('message', (raw) => {
			const bytes = raw instanceof Buffer ? new Uint8Array(raw) : new Uint8Array(raw as ArrayBuffer)
			received.push(bytes.slice())
			const frame = parseFrame(bytes)
			if (frame.type === 0x1) {
				socket.send(jsonFrame(0, undefined, { result: { text: 'connected' } }))
				return
			}
			if (frame.type !== 0x2) return
			if (frame.sequence !== undefined && frame.sequence < 0) {
				if (options.errorCode !== undefined) {
					socket.send(errorFrame(options.errorCode, { error: 'mock provider error' }))
				} else if (options.malformedFrame) {
					socket.send(options.malformedFrame)
				} else {
					socket.send(jsonFrame(3, 1, { result: { text: options.finalText ?? 'mock final' } }))
				}
				return
			}
			audioCount++
			if (options.disconnectAfterAudio !== undefined && audioCount >= options.disconnectAfterAudio) {
				socket.close()
				return
			}
			if (audioCount % partialEvery === 0 && socket.readyState === OPEN) {
				socket.send(jsonFrame(0, undefined, { result: { text: options.partialText ?? 'mock partial' } }))
			}
		})
		socket.on('close', () => sockets.delete(socket))
	})

	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const address = server.address()
	if (address === null || typeof address === 'string') throw new Error('mock server did not bind')

	return {
		endpoint: `ws://127.0.0.1:${address.port}`,
		received,
		async close() {
			for (const socket of sockets) socket.close()
			wss.close()
			await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
		},
	}
}
