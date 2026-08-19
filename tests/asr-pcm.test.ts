import { describe, expect, test } from 'vitest'
import {
	downmixToMonoSample,
	float32ToInt16,
	int16ToPcmBytes,
	quantizePcmSample,
} from '../src/asr/pcm'

describe('ASR PCM pipeline', () => {
	test('does not expose test-only PCM or protocol wrappers', async () => {
		const pcm = await import('../src/asr/pcm')
		const protocol = await import('../src/asr/doubao/protocol')
		expect(Object.hasOwn(pcm, 'chunkPcm16')).toBe(false)
		expect(Object.hasOwn(pcm, 'float32ToPcm16')).toBe(false)
		expect(Object.hasOwn(protocol, 'decodeServerFrame')).toBe(false)
	})

	test('clamps and quantises float samples at the signed 16-bit limits', () => {
		expect(quantizePcmSample(-2)).toBe(-32_768)
		expect(quantizePcmSample(-1)).toBe(-32_768)
		expect(quantizePcmSample(-0.5)).toBe(-16_384)
		expect(quantizePcmSample(0)).toBe(0)
		expect(quantizePcmSample(0.5)).toBe(16_384)
		expect(quantizePcmSample(1)).toBe(32_767)
		expect(quantizePcmSample(2)).toBe(32_767)
	})

	test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
		'rejects non-finite sample %s',
		(sample) => {
			expect(() => quantizePcmSample(sample)).toThrow(RangeError)
		},
	)

	test('writes PCM samples as little-endian bytes', () => {
		const samples = float32ToInt16(Float32Array.from([-1, -0.5, 0.5, 1]))
		const bytes = int16ToPcmBytes(samples)
		expect([...bytes]).toEqual([0, 128, 0, 192, 0, 64, 255, 127])
		expect(int16ToPcmBytes(float32ToInt16(Float32Array.from([-1, 1])))).toEqual(
			Uint8Array.from([0, 128, 255, 127]),
		)
	})

	test('downmixes stereo samples before byte-level PCM encoding', () => {
		const channels = [Float32Array.from([0.5, -1]), Float32Array.from([0.25, 1])]
		const mono = Float32Array.from([
			downmixToMonoSample(channels, 0),
			downmixToMonoSample(channels, 1),
		])

		expect(int16ToPcmBytes(float32ToInt16(mono))).toEqual(Uint8Array.from([0, 48, 0, 0]))
	})

	test('can fill a caller-owned quantisation target', () => {
		const target = new Int16Array(3)
		const result = float32ToInt16(Float32Array.from([0, 0.5]), target)
		expect(result).toEqual(Int16Array.from([0, 16_384]))
		expect(result.buffer).toBe(target.buffer)
	})
})
