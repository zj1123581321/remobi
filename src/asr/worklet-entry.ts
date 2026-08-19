import { PCM_CHUNK_SAMPLES, quantizePcmSample } from './pcm'

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
	final: boolean
}

interface FlushAckMessage {
	readonly type: 'flush-ack'
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
		final: false,
	}
	private sampleOffset = 0

	constructor() {
		super()
		this.port.onmessage = (event: MessageEvent<WorkletCommand>) => {
			if (event.data.type === 'start') {
				this.sampleOffset = 0
				return
			}
			this.flush()
		}
	}

	private emitChunk(final: boolean): void {
		for (let index = 0; index < this.sampleOffset; index++) {
			this.intBuffer[index] = quantizePcmSample(this.sampleBuffer[index] ?? 0)
		}
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
		const channel = inputs[0]?.[0]
		if (!channel) return true
		for (let index = 0; index < channel.length; index++) {
			this.sampleBuffer[this.sampleOffset++] = channel[index] ?? 0
			if (this.sampleOffset === PCM_CHUNK_SAMPLES) this.emitChunk(false)
		}
		return true
	}
}

registerProcessor('remobi-pcm-processor', RemobiPcmProcessor)
