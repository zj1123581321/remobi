import { PCM_CHUNK_BYTES, PCM_SAMPLE_RATE, int16ToPcmBytes } from '../pcm'
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
	onopen: (() => void) | null
	onerror: ((event: { readonly message?: string }) => void) | null
	onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null
	onmessage: ((event: { readonly data: unknown }) => void) | null
	send(data: Uint8Array): void
	close(): void
}

export type WebSocketFactory = (url: string) => WebSocketLike

export interface PcmCapture {
	start(onSamples: (samples: Int16Array) => void): Promise<void>
	stop(): Promise<void>
	getPcmInFlightBytes(): number
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
	if (error instanceof Error && error.name === 'NotSupportedError') {
		return 'audio-context'
	}
	if (error instanceof Error && error.name === 'UnsupportedSampleRateError') {
		return 'unsupported-sample-rate'
	}
	if (error instanceof Error && error.name === 'WorkletLoadError') {
		return 'worklet-load-failed'
	}
	return 'connection-failed'
}

function getText(value: unknown): string | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
	if (!('result' in value) || typeof value.result !== 'object' || value.result === null) {
		return undefined
	}
	const result = value.result
	if ('text' in result && typeof result.text === 'string') return result.text
	if (!('utterances' in result) || !Array.isArray(result.utterances)) return undefined
	const texts: string[] = []
	for (const utterance of result.utterances) {
		if (typeof utterance === 'object' && utterance !== null && 'text' in utterance) {
			if (typeof utterance.text === 'string') texts.push(utterance.text)
		}
	}
	return texts.length > 0 ? texts.join('') : undefined
}

class BrowserWebSocketAdapter implements WebSocketLike {
	private readonly socket: WebSocket

	constructor(socket: WebSocket) {
		this.socket = socket
		this.socket.binaryType = 'arraybuffer'
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
		this.socket.onerror = handler === null ? null : (event) => handler({ message: event.type })
	}

	set onclose(handler:
		| ((event: { readonly code: number; readonly reason: string }) => void)
		| null) {
		this.socket.onclose =
			handler === null ? null : (event) => handler({ code: event.code, reason: event.reason })
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

function browserWebSocketFactory(url: string): WebSocketLike {
	return new BrowserWebSocketAdapter(new WebSocket(url))
}

class BrowserPcmCapture implements PcmCapture {
	private readonly workletUrl: string
	private context: AudioContext | undefined
	private stream: MediaStream | undefined
	private source: MediaStreamAudioSourceNode | undefined
	private node: AudioWorkletNode | undefined
	private onSamples: ((samples: Int16Array) => void) | undefined
	private flushWaiter: { readonly epoch: number; readonly resolve: () => void } | undefined
	private epoch = 0
	private stopPromise: Promise<void> | undefined
	private workletPosted = 0
	private workletReceived = 0

	constructor(workletUrl: string) {
		this.workletUrl = workletUrl
	}

	async start(onSamples: (samples: Int16Array) => void): Promise<void> {
		const previousStop = this.stopPromise
		if (previousStop) {
			await previousStop
			if (this.stopPromise === previousStop) this.stopPromise = undefined
		}
		const epoch = ++this.epoch
		this.workletPosted = 0
		this.workletReceived = 0
		if (!globalThis.navigator?.mediaDevices?.getUserMedia || !globalThis.AudioContext) {
			throw new Error('AudioWorklet capture is not supported')
		}
		this.onSamples = onSamples
		this.stream = await globalThis.navigator.mediaDevices.getUserMedia({ audio: true })
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
			const error = new Error(`AudioContext sample rate is ${this.context.sampleRate}`)
			error.name = 'UnsupportedSampleRateError'
			throw error
		}
		if (this.context.state === 'suspended') await this.context.resume()
		try {
			await this.context.audioWorklet.addModule(this.workletUrl)
		} catch (error) {
			const failure = new Error('AudioWorklet module failed to load', { cause: error })
			failure.name = 'WorkletLoadError'
			throw failure
		}
		this.node = new AudioWorkletNode(this.context, WORKLET_PROCESSOR_NAME)
		this.node.port.onmessage = (
			event: MessageEvent<{ type: 'pcm'; samples: Int16Array; posted: number } | { type: 'flush-ack' }>,
		) => {
			if (epoch !== this.epoch) return
			if (event.data.type === 'pcm') {
				this.workletPosted = Math.max(this.workletPosted, event.data.posted)
				this.workletReceived++
				this.onSamples?.(event.data.samples)
			}
			if (event.data.type === 'flush-ack') {
				const waiter = this.flushWaiter
				if (waiter?.epoch === epoch) {
					this.flushWaiter = undefined
					waiter.resolve()
				}
			}
		}
		this.source = this.context.createMediaStreamSource(this.stream)
		this.source.connect(this.node)
		this.node.connect(this.context.destination)
		this.node.port.postMessage({ type: 'start' })
	}

	getPcmInFlightBytes(): number {
		return Math.max(0, this.workletPosted - this.workletReceived) * PCM_CHUNK_BYTES
	}

	async stop(): Promise<void> {
		if (this.stopPromise) return this.stopPromise
		const epoch = this.epoch
		const promise = this.stopCurrentEpoch(epoch)
		this.stopPromise = promise
		void promise.then(
			() => {
				if (this.stopPromise === promise) this.stopPromise = undefined
			},
			() => {
				if (this.stopPromise === promise) this.stopPromise = undefined
			},
		)
		return promise
	}

	private async stopCurrentEpoch(epoch: number): Promise<void> {
		this.source?.disconnect()
		for (const track of this.stream?.getTracks() ?? []) track.stop()
		const node = this.node
		if (node) {
			await new Promise<void>((resolve) => {
				this.flushWaiter = { epoch, resolve }
				node.port.postMessage({ type: 'flush' })
			})
			if (this.flushWaiter?.epoch === epoch) this.flushWaiter = undefined
		}
		node?.port.close()
		node?.disconnect()
		await this.dispose(epoch)
	}

	private async dispose(epoch = this.epoch): Promise<void> {
		if (epoch !== this.epoch) return
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
	private epoch = 0
	private captureStopPromise: Promise<void> | undefined
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
		const captureSupported =
			this.options.capture !== undefined ||
			(Boolean(globalThis.AudioContext) &&
				Boolean(globalThis.AudioWorkletNode) &&
				Boolean(globalThis.navigator?.mediaDevices?.getUserMedia))
		const websocketSupported =
			this.options.websocketFactory !== undefined || Boolean(globalThis.WebSocket)
		return captureSupported && websocketSupported
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
		const epoch = ++this.epoch
		this.state = 'starting'
		this.reportedError = false
		this.audioFrameCount = 0
		this.queuedAudio = []
		this.queuedBytes = 0
		const previousStop = this.captureStopPromise
		if (previousStop) {
			await previousStop
			if (this.captureStopPromise === previousStop) this.captureStopPromise = undefined
		}
		if (!this.isSupported()) {
			this.fail('unsupported', epoch)
			throw new Error('ASR is not supported in this browser')
		}
		try {
			await this.openSocket(epoch)
			if (epoch !== this.epoch) return
			await this.capture.start((samples) => {
				if (epoch === this.epoch) this.sendPcm(samples)
			})
			if (epoch !== this.epoch) return
			this.state = 'recording'
			this.startBackpressureMonitor(epoch)
		} catch (error) {
			this.fail(errorCode(error), epoch)
			throw error
		}
	}

	async stop(): Promise<void> {
		if (this.state === 'idle') return
		if (this.state === 'stopping') return this.waitForFinal()
		const epoch = this.epoch
		this.state = 'stopping'
		this.stopBackpressureMonitor()
		await this.requestCaptureStop()
		if (epoch !== this.epoch || this.reportedError) return
		this.flushQueue()
		if (!this.socket || this.socket.readyState !== OPEN) {
			this.fail('socket-closed', epoch)
			return
		}
		this.socket.send(encodeEndFrame(-(this.audioFrameCount + 2)))
		await this.waitForFinal()
		if (epoch !== this.epoch) return
		this.cleanup()
	}

	/** Test seam for a captured worklet chunk; browser capture calls the same path. */
	ingestPcm(samples: Int16Array): void {
		this.sendPcm(samples)
	}

	private async openSocket(epoch: number): Promise<void> {
		const endpoint = this.options.endpoint ?? DEFAULT_ENDPOINT
		const params = new URLSearchParams({
			api_key: this.options.apiKey,
			api_resource_id: this.options.resourceId,
		})
		const socket = this.websocketFactory(`${endpoint}?${params.toString()}`)
		this.socket = socket
		socket.onmessage = (event) => {
			if (epoch === this.epoch) this.handleMessage(event.data, epoch)
		}
		socket.onclose = () => {
			if (epoch !== this.epoch) return
			if (this.state === 'recording') this.fail('socket-closed', epoch)
			else this.finalWaiter?.()
		}
		const runtimeError = (_event: { readonly message?: string }): void => {
			if (epoch !== this.epoch) return
			if (this.state === 'starting' || this.state === 'recording') {
				this.fail('connection-failed', epoch)
			}
		}
		socket.onerror = runtimeError
		await new Promise<void>((resolve, reject) => {
			 socket.onopen = () => {
				if (epoch !== this.epoch) {
					resolve()
					return
				}
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
			socket.onerror = (event) => {
				runtimeError(event)
				reject(new Error('ASR websocket connection failed'))
			}
		})
		socket.onerror = runtimeError
	}

	private handleMessage(data: unknown, epoch: number): void {
		if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) {
			this.fail('protocol-error', epoch)
			return
		}
		const bytes =
			data instanceof ArrayBuffer
				? data
				: new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
		try {
			const frame = decodeFrame(bytes)
			if (frame.kind === 'error') {
				this.fail('provider-error', epoch)
				return
			}
			if (frame.kind !== 'server-response') {
				this.fail('protocol-error', epoch)
				return
			}
			if (frame.flags === 3) this.finalWaiter?.()
			const text = getText(frame.json)
			if (text === undefined) return
			if (frame.flags === 3) {
				for (const handler of this.finalHandlers) handler(text)
			} else {
				for (const handler of this.partialHandlers) handler(text)
			}
		} catch {
			this.fail('protocol-error', epoch)
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

	private startBackpressureMonitor(epoch: number): void {
		this.backpressureTimer = setInterval(() => {
			if (epoch !== this.epoch) return
			const socketBytes = this.socket?.bufferedAmount ?? 0
			const workletBytes = this.capture.getPcmInFlightBytes()
			if (this.queuedBytes + workletBytes + socketBytes > BACKPRESSURE_LIMIT_BYTES) {
				this.fail('network-too-slow', epoch)
			}
			if (this.socket?.readyState === CLOSING || this.socket?.readyState === CLOSED) {
				this.fail('socket-closed', epoch)
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

	private requestCaptureStop(): Promise<void> {
		if (this.captureStopPromise) return this.captureStopPromise
		const promise = this.capture.stop()
		this.captureStopPromise = promise
		void promise.then(
			() => {
				if (this.captureStopPromise === promise) this.captureStopPromise = undefined
			},
			() => {
				if (this.captureStopPromise === promise) this.captureStopPromise = undefined
			},
		)
		return promise
	}

	private fail(code: AsrErrorCode, epoch: number): void {
		if (epoch !== this.epoch || this.reportedError) return
		this.reportedError = true
		this.epoch++
		this.state = 'idle'
		this.stopBackpressureMonitor()
		this.finalWaiter?.()
		this.finalWaiter = undefined
		if (this.finalTimer) clearTimeout(this.finalTimer)
		this.finalTimer = undefined
		for (const handler of this.errorHandlers) handler(code)
		this.socket?.close()
		void this.requestCaptureStop()
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
		this.epoch++
		this.state = 'idle'
	}
}
