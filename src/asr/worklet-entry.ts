import { PCM_CHUNK_SAMPLES, downmixToMonoSample, quantizePcmSample } from './pcm'

interface FlushMessage {
	readonly type: 'flush'
}

interface StartMessage {
	readonly type: 'start'
}

type WorkletCommand = FlushMessage | StartMessage

interface PcmMessage {
	readonly type: 'pcm'
	readonly samples: Int16Array
	posted: number
	final: boolean
}

interface FlushAckMessage {
	readonly type: 'flush-ack'
}

interface WorkletErrorMessage {
	readonly type: 'error'
	readonly error: 'unknown-worklet-command'
}

declare abstract class AudioWorkletProcessor {
	readonly port: MessagePort
	constructor()
	abstract process(
		inputs: readonly (readonly Float32Array[])[],
		outputs: readonly (readonly Float32Array[])[],
		parameters: Record<string, Float32Array>,
	): boolean
}

declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void

class RemobiPcmProcessor extends AudioWorkletProcessor {
	private readonly sampleBuffer = new Float32Array(PCM_CHUNK_SAMPLES)
	private readonly intBuffer = new Int16Array(PCM_CHUNK_SAMPLES)
	private readonly pcmMessage: PcmMessage = {
		type: 'pcm',
		samples: this.intBuffer,
		posted: 0,
		final: false,
	}
	private sampleOffset = 0
	private postedCount = 0

	constructor() {
		super()
		this.port.onmessage = (event: MessageEvent<WorkletCommand>) => {
			switch (event.data.type) {
				case 'start':
					this.sampleOffset = 0
					this.postedCount = 0
					return
				case 'flush':
					this.flush()
					return
				default: {
					const error: WorkletErrorMessage = {
						type: 'error',
						error: 'unknown-worklet-command',
					}
					this.port.postMessage(error)
					return
				}
			}
		}
	}

	private emitChunk(final: boolean): void {
		for (let index = 0; index < this.sampleOffset; index++) {
			const sample = this.sampleBuffer[index]
			if (sample === undefined) throw new RangeError('PCM worklet sample is missing')
			this.intBuffer[index] = quantizePcmSample(sample)
		}
		this.pcmMessage.posted = ++this.postedCount
		this.pcmMessage.final = final
		this.port.postMessage(this.pcmMessage)
		this.sampleOffset = 0
	}

	private flush(): void {
		if (this.sampleOffset > 0) this.emitChunk(true)
		const ack: FlushAckMessage = { type: 'flush-ack' }
		this.port.postMessage(ack)
	}

	process(
		inputs: readonly (readonly Float32Array[])[],
		_outputs: readonly (readonly Float32Array[])[],
		_parameters: Record<string, Float32Array>,
	): boolean {
		const channels = inputs[0]
		if (channels === undefined || channels.length === 0) return true
		const firstChannel = channels[0]
		if (firstChannel === undefined) return true
		for (let index = 0; index < firstChannel.length; index++) {
			this.sampleBuffer[this.sampleOffset++] = downmixToMonoSample(channels, index)
			if (this.sampleOffset === PCM_CHUNK_SAMPLES) this.emitChunk(false)
		}
		return true
	}
}

registerProcessor('remobi-pcm-processor', RemobiPcmProcessor)
