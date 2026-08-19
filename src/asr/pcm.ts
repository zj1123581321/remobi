export const PCM_SAMPLE_RATE = 16_000
export const PCM_CHANNELS = 1
export const PCM_CHUNK_SAMPLES = 1_600
export const PCM_SAMPLE_BYTES = 2
export const PCM_CHUNK_BYTES = PCM_CHUNK_SAMPLES * PCM_SAMPLE_BYTES

/** Quantise one normalised float sample to signed 16-bit PCM. */
export function quantizePcmSample(sample: number): number {
	if (sample <= -1) return -32_768
	if (sample >= 1) return 32_767
	return sample < 0 ? Math.round(sample * 32_768) : Math.round(sample * 32_767)
}

/** Convert float samples to an Int16Array. The optional target avoids allocation in callers. */
export function float32ToInt16(
	samples: Float32Array,
	target: Int16Array = new Int16Array(samples.length),
): Int16Array {
	if (target.length < samples.length) {
		throw new RangeError('PCM target is smaller than the source sample array')
	}
	for (let index = 0; index < samples.length; index++) {
		target[index] = quantizePcmSample(samples[index] ?? 0)
	}
	return target.subarray(0, samples.length)
}

/** Encode signed samples as little-endian PCM bytes. */
export function int16ToPcmBytes(samples: Int16Array): Uint8Array {
	const bytes = new Uint8Array(samples.length * PCM_SAMPLE_BYTES)
	const view = new DataView(bytes.buffer)
	for (let index = 0; index < samples.length; index++) {
		view.setInt16(index * PCM_SAMPLE_BYTES, samples[index] ?? 0, true)
	}
	return bytes
}

/** Convert normalised float samples directly to little-endian PCM bytes. */
export function float32ToPcm16(samples: Float32Array): Uint8Array {
	return int16ToPcmBytes(float32ToInt16(samples))
}

/** Split PCM bytes into 100ms chunks, retaining one final short chunk when needed. */
export function chunkPcm16(pcm: Uint8Array): readonly Uint8Array[] {
	if (pcm.byteLength % PCM_SAMPLE_BYTES !== 0) {
		throw new RangeError('PCM byte length must contain whole 16-bit samples')
	}
	const chunks: Uint8Array[] = []
	for (let offset = 0; offset < pcm.byteLength; offset += PCM_CHUNK_BYTES) {
		chunks.push(pcm.slice(offset, Math.min(offset + PCM_CHUNK_BYTES, pcm.byteLength)))
	}
	return chunks
}
