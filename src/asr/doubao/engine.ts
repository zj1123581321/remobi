import { PCM_SAMPLE_RATE, int16ToPcmBytes } from '../pcm'
import type {
	AsrEngine,
	AsrErrorCode,
	AsrErrorHandler,
	AsrTextHandler,
	AsrUnsubscribe,
} from '../types'
import { createFullRequest, decodeFrame, encodeAudioFrame, encodeEndFrame } from './protocol'

const DEFAULT_ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async'
const DEFAULT_WORKLET_URL = 'asr-worklet.js'
const WORKLET_PROCESSOR_NAME = 'remobi-pcm-processor'
const OPEN = 1
const CLOSING = 2
const CLOSED = 3
const BACKPRESSURE_INTERVAL_MS = 100
const BACKPRESSURE_LIMIT_BYTES = PCM_SAMPLE_RATE * 2 * 2
const FINAL_TIMEOUT_MS = 3_000

export interface WebSocketLike {
	readonly readyState: number
	readonly bufferedAmount: number
	onopen: ((event: never) => void) | null
	onerror: ((event: never) => void) | null
	onclose: ((event: never) => void) | null
	onmessage: ((event: never) => void) | null
	send(data: Uint8Array): void
	close(): void
}

export type WebSocketFactory = (url: string) => WebSocketLike

export interface PcmCapture {
	start(onSamples: (samples: Int16Array) => void): Promise<void>
	stop(): Promise<void>
}

export interface DoubaoEngineOptions {
	readonly apiKey: string
	readonly resourceId: string
	readonly uid?: string
	readonly endpoint?: string
	readonly workletUrl?: string
	readonly websocketFactory?: WebSocketFactory
	readonly capture?: PcmCapture
}

function unsubscribe<T>(handlers: Set<T>, handler: T): AsrUnsubscribe {
	handlers.add(handler)
	return () => handlers.delete(handler)
}

function errorCode(error: unknown): AsrErrorCode {
	if (error instanceof DOMException && error.name === 'NotAllowedError') {
		return 'permission-denied'
	}
	return 'connection-failed'
}

function getText(value: unknown): string | undefined {
	if (typeof value !== 'object' || value === null) return undefined
	if ('text' in value && typeof value.text === 'string') return value.text
	if ('utterances' in value && Array.isArray(value.utterances)) {
		const text = value.utterances
			.map((item) => getText(item))
			.filter((item): item is string => item !== undefined)
			.join('')
		if (text.length > 0) return text
	}
	for (const child of Object.values(value)) {
		const text = getText(child)
		if (text !== undefined) return text
	}
	return undefined
}

function browserWebSocketFactory(url: string): WebSocketLike {
	return new WebSocket(url) as unknown as WebSocketLike
}

class BrowserPcmCapture implements PcmCapture {
	private readonly workletUrl: string
	private context: AudioContext | undefined
	private stream: MediaStream | undefined
	private source: MediaStreamAudioSourceNode | undefined
	private node: AudioWorkletNode | undefined
	private onSamples: ((samples: Int16Array) => void) | undefined
	private flushWaiter: (() => void) | undefined

	constructor(workletUrl: string) {
		this.workletUrl = workletUrl
	}

	async start(onSamples: (samples: Int16Array) => void): Promise<void> {
		if (!navigator.mediaDevices?.getUserMedia || !globalThis.AudioContext) {
			throw new Error('AudioWorklet capture is not supported')
		}
		this.onSamples = onSamples
		this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
		try {
			this.context = new AudioContext({ sampleRate: PCM_SAMPLE_RATE })
		} catch (error) {
			for (const track of this.stream.getTracks()) track.stop()
			this.stream = undefined
			throw error
		}
		if (this.context.sampleRate !== PCM_SAMPLE_RATE) {
			for (const track of this.stream.getTracks()) track.stop()
			await this.dispose()
			throw new Error(`AudioContext sample rate is ${this.context.sampleRate}`)
		}
		if (this.context.state === 'suspended') await this.context.resume()
		await this.context.audioWorklet.addModule(this.workletUrl)
		this.node = new AudioWorkletNode(this.context, WORKLET_PROCESSOR_NAME)
		this.node.port.onmessage = (
			event: MessageEvent<{ type: 'pcm'; samples: Int16Array } | { type: 'flush-ack' }>,
		) => {
			if (event.data.type === 'pcm') this.onSamples?.(event.data.samples)
			if (event.data.type === 'flush-ack') this.flushWaiter?.()
		}
		this.source = this.context.createMediaStreamSource(this.stream)
		this.source.connect(this.node)
		this.node.connect(this.context.destination)
		this.node.port.postMessage({ type: 'start' })
	}

	async stop(): Promise<void> {
		this.source?.disconnect()
		for (const track of this.stream?.getTracks() ?? []) track.stop()
		if (this.node) {
			await new Promise<void>((resolve) => {
				this.flushWaiter = resolve
				this.node?.port.postMessage({ type: 'flush' })
			})
			this.flushWaiter = undefined
		}
		this.node?.port.close()
		this.node?.disconnect()
		await this.dispose()
	}

	private async dispose(): Promise<void> {
		this.source = undefined
		this.node = undefined
		this.onSamples = undefined
		this.stream = undefined
		const context = this.context
		this.context = undefined
		if (context) await context.close()
	}
}

/** Browser-direct Doubao SAUC engine. The optional capture/websocket seams are test-only injection points. */
export class DoubaoEngine implements AsrEngine {
	private readonly options: DoubaoEngineOptions
	private readonly partialHandlers = new Set<AsrTextHandler>()
	private readonly finalHandlers = new Set<AsrTextHandler>()
	private readonly errorHandlers = new Set<AsrErrorHandler>()
	private readonly websocketFactory: WebSocketFactory
	private readonly capture: PcmCapture
	private socket: WebSocketLike | undefined
	private state: 'idle' | 'starting' | 'recording' | 'stopping' = 'idle'
	private audioFrameCount = 0
	private queuedAudio: Uint8Array[] = []
	private queuedBytes = 0
	private backpressureTimer: ReturnType<typeof setInterval> | undefined
	private finalTimer: ReturnType<typeof setTimeout> | undefined
	private finalWaiter: (() => void) | undefined
	private reportedError = false

	constructor(options: DoubaoEngineOptions) {
		this.options = options
		this.websocketFactory = options.websocketFactory ?? browserWebSocketFactory
		this.capture =
			options.capture ?? new BrowserPcmCapture(options.workletUrl ?? DEFAULT_WORKLET_URL)
	}

	isSupported(): boolean {
		return (
			(this.options.capture !== undefined ||
				(Boolean(globalThis.AudioContext) &&
					Boolean(globalThis.AudioWorkletNode) &&
					Boolean(navigator.mediaDevices?.getUserMedia))) &&
			Boolean(globalThis.WebSocket || this.options.websocketFactory)
		)
	}

	onPartial(handler: AsrTextHandler): AsrUnsubscribe {
		return unsubscribe(this.partialHandlers, handler)
	}

	onFinal(handler: AsrTextHandler): AsrUnsubscribe {
		return unsubscribe(this.finalHandlers, handler)
	}

	onError(handler: AsrErrorHandler): AsrUnsubscribe {
		return unsubscribe(this.errorHandlers, handler)
	}

	async start(): Promise<void> {
		if (this.state !== 'idle') return
		this.state = 'starting'
		this.reportedError = false
		this.audioFrameCount = 0
		this.queuedAudio = []
		this.queuedBytes = 0
		if (!this.isSupported()) {
			this.fail('unsupported')
			throw new Error('ASR is not supported in this browser')
		}
		try {
			await this.openSocket()
			await this.capture.start((samples) => this.sendPcm(samples))
			this.state = 'recording'
			this.startBackpressureMonitor()
		} catch (error) {
			this.fail(errorCode(error))
			throw error
		}
	}

	async stop(): Promise<void> {
		if (this.state === 'idle') return
		if (this.state === 'stopping') return this.waitForFinal()
		this.state = 'stopping'
		this.stopBackpressureMonitor()
		await this.capture.stop()
		this.flushQueue()
		if (!this.socket || this.socket.readyState !== OPEN) {
			this.fail('socket-closed')
			return
		}
		this.socket.send(encodeEndFrame(-(this.audioFrameCount + 2)))
		await this.waitForFinal()
		this.cleanup()
	}

	/** Test seam for a captured worklet chunk; browser capture calls the same path. */
	ingestPcm(samples: Int16Array): void {
		this.sendPcm(samples)
	}

	private async openSocket(): Promise<void> {
		const endpoint = this.options.endpoint ?? DEFAULT_ENDPOINT
		const params = new URLSearchParams({
			api_key: this.options.apiKey,
			api_resource_id: this.options.resourceId,
		})
		const socket = this.websocketFactory(`${endpoint}?${params.toString()}`)
		this.socket = socket
		socket.onmessage = (event) =>
			this.handleMessage((event as unknown as { readonly data: unknown }).data)
		socket.onclose = () => {
			if (this.state === 'recording') this.fail('socket-closed')
			else this.finalWaiter?.()
		}
		socket.onerror = () => {
			if (this.state === 'starting' || this.state === 'recording') this.fail('connection-failed')
		}
		await new Promise<void>((resolve, reject) => {
			socket.onopen = () => {
				if (socket.readyState !== OPEN) {
					reject(new Error('ASR websocket did not open'))
					return
				}
				socket.send(
					createFullRequest({
						uid: this.options.uid,
					}),
				)
				resolve()
			}
			socket.onerror = () => reject(new Error('ASR websocket connection failed'))
		})
	}

	private handleMessage(data: unknown): void {
		if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) {
			this.fail('protocol-error')
			return
		}
		const bytes =
			data instanceof ArrayBuffer
				? data
				: new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
		try {
			const frame = decodeFrame(bytes)
			if (frame.kind === 'error') {
				this.fail('provider-error')
				return
			}
			if (frame.kind !== 'server-response') {
				this.fail('protocol-error')
				return
			}
			const text = getText(frame.json)
			if (text === undefined) return
			if (frame.flags === 3) {
				for (const handler of this.finalHandlers) handler(text)
				this.finalWaiter?.()
			} else {
				for (const handler of this.partialHandlers) handler(text)
			}
		} catch {
			this.fail('protocol-error')
		}
	}

	private sendPcm(samples: Int16Array): void {
		if (this.state !== 'recording' && this.state !== 'stopping') return
		const bytes = encodeAudioFrame(int16ToPcmBytes(samples))
		this.audioFrameCount++
		if (!this.socket || this.socket.readyState !== OPEN) {
			this.queuedAudio.push(bytes)
			this.queuedBytes += bytes.byteLength
			return
		}
		this.socket.send(bytes)
	}

	private flushQueue(): void {
		if (!this.socket || this.socket.readyState !== OPEN) return
		for (const frame of this.queuedAudio) this.socket.send(frame)
		this.queuedAudio = []
		this.queuedBytes = 0
	}

	private startBackpressureMonitor(): void {
		this.backpressureTimer = setInterval(() => {
			const socketBytes = this.socket?.bufferedAmount ?? 0
			if (this.queuedBytes + socketBytes > BACKPRESSURE_LIMIT_BYTES) {
				this.fail('network-too-slow')
			}
			if (this.socket?.readyState === CLOSING || this.socket?.readyState === CLOSED) {
				this.fail('socket-closed')
			}
		}, BACKPRESSURE_INTERVAL_MS)
	}

	private stopBackpressureMonitor(): void {
		if (this.backpressureTimer) clearInterval(this.backpressureTimer)
		this.backpressureTimer = undefined
	}

	private waitForFinal(): Promise<void> {
		if (this.finalWaiter) {
			return new Promise((resolve) => {
				const previous = this.finalWaiter
				this.finalWaiter = () => {
					previous?.()
					resolve()
				}
			})
		}
		return new Promise((resolve) => {
			this.finalWaiter = resolve
			this.finalTimer = setTimeout(resolve, FINAL_TIMEOUT_MS)
		})
	}

	private fail(code: AsrErrorCode): void {
		if (this.reportedError) return
		this.reportedError = true
		for (const handler of this.errorHandlers) handler(code)
		this.stopBackpressureMonitor()
		this.state = 'idle'
		this.socket?.close()
		void this.capture.stop()
	}

	private cleanup(): void {
		this.stopBackpressureMonitor()
		if (this.finalTimer) clearTimeout(this.finalTimer)
		this.finalTimer = undefined
		this.finalWaiter = undefined
		this.socket?.close()
		this.socket = undefined
		this.queuedAudio = []
		this.queuedBytes = 0
		this.state = 'idle'
	}
}
