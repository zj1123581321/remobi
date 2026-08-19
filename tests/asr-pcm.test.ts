import { describe, expect, test } from 'vitest'
import {
	PCM_CHUNK_BYTES,
	chunkPcm16,
	float32ToInt16,
	float32ToPcm16,
	int16ToPcmBytes,
	quantizePcmSample,
} from '../src/asr/pcm'

describe('ASR PCM pipeline', () => {
	test('clamps and quantises float samples at the signed 16-bit limits', () => {
		expect(quantizePcmSample(-2)).toBe(-32_768)
		expect(quantizePcmSample(-1)).toBe(-32_768)
		expect(quantizePcmSample(-0.5)).toBe(-16_384)
		expect(quantizePcmSample(0)).toBe(0)
		expect(quantizePcmSample(0.5)).toBe(16_384)
		expect(quantizePcmSample(1)).toBe(32_767)
		expect(quantizePcmSample(2)).toBe(32_767)
	})

	test('writes PCM samples as little-endian bytes', () => {
		const samples = float32ToInt16(Float32Array.from([-1, -0.5, 0.5, 1]))
		const bytes = int16ToPcmBytes(samples)
		expect([...bytes]).toEqual([0, 128, 0, 192, 0, 64, 255, 127])
		expect(float32ToPcm16(Float32Array.from([-1, 1]))).toEqual(Uint8Array.from([0, 128, 255, 127]))
	})

	test('creates 100ms chunks and keeps a short final chunk', () => {
		const pcm = new Uint8Array(PCM_CHUNK_BYTES * 2 + 4)
		const chunks = chunkPcm16(pcm)
		expect(chunks.map((chunk) => chunk.byteLength)).toEqual([PCM_CHUNK_BYTES, PCM_CHUNK_BYTES, 4])
	})

	test('handles empty input and rejects partial samples', () => {
		expect(chunkPcm16(new Uint8Array())).toEqual([])
		expect(() => chunkPcm16(Uint8Array.from([1]))).toThrow('whole 16-bit samples')
	})

	test('can fill a caller-owned quantisation target', () => {
		const target = new Int16Array(3)
		const result = float32ToInt16(Float32Array.from([0, 0.5]), target)
		expect(result).toEqual(Int16Array.from([0, 16_384]))
		expect(result.buffer).toBe(target.buffer)
	})
})
