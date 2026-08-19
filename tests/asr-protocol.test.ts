import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
	decodeFrame,
	encodeAudioFrame,
	encodeEndFrame,
	encodeFullRequest,
} from '../src/asr/doubao/protocol'

const fixtureRoot = 'tests/fixtures/asr/20260819T052830488Z-query-seedasr-duration-2b7d8bd5'
const variantRoot =
	'tests/fixtures/asr/20260819T052830811Z-query-seedasr-duration-end-variant-neg-no-seq-73fd940e'

function fixture(root: string, name: string): Uint8Array {
	const hex = readFileSync(`${root}/${name}`, 'utf8').replace(/\s+/g, '')
	return Uint8Array.from(Buffer.from(hex, 'hex'))
}

describe('doubao SAUC protocol', () => {
	test('encodes the real full request bytes', () => {
		const golden = fixture(fixtureRoot, '000-send-full-client-request.hex')
		expect(encodeFullRequest(golden.slice(8))).toEqual(golden)
		expect(golden[0] >> 4).toBe(1)
		expect(golden[0] & 0x0f).toBe(1)
		expect(golden[1] >> 4).toBe(1)
		expect(golden[1] & 0x0f).toBe(0)
		expect(golden[2] >> 4).toBe(1)
		expect(golden[2] & 0x0f).toBe(0)
		expect(new DataView(golden.buffer).getUint32(4)).toBe(178)
	})

	test('encodes real PCM audio bytes without changing little-endian samples', () => {
		const golden = fixture(fixtureRoot, '001-send-audio-1.hex')
		expect(encodeAudioFrame(golden.slice(8))).toEqual(golden)
		expect(new DataView(golden.buffer).getUint32(4)).toBe(3200)
		expect(new DataView(golden.buffer, 8).getInt16(2, true)).toBe(0x080f)
	})

	test('decodes sequence end and server partial/final frames', () => {
		const end = decodeFrame(fixture(fixtureRoot, '011-send-end-neg-with-seq.hex'))
		expect(end).toMatchObject({ kind: 'audio', flags: 3, sequence: -12, payload: new Uint8Array() })

		const partial = decodeFrame(fixture(fixtureRoot, '012-recv-server-partial.hex'))
		expect(partial).toMatchObject({ kind: 'server-response', flags: 0 })
		expect(partial.payloadText).toContain('log_id')

		const final = decodeFrame(fixture(fixtureRoot, '013-recv-server-final.hex'))
		expect(final).toMatchObject({ kind: 'server-response', flags: 3, sequence: 1 })
		expect(final.json).toMatchObject({ audio_info: { duration: 1000 } })
	})

	test('decodes the accepted no-sequence end variant', () => {
		const frame = decodeFrame(fixture(variantRoot, '011-send-end-neg-no-seq.hex'))
		expect(frame).toMatchObject({ kind: 'audio', flags: 2, payload: new Uint8Array() })
		expect('sequence' in frame).toBe(false)
	})

	test('decodes protocol error code and payload at offset 12', () => {
		const frame = decodeFrame(
			fixture(
				'tests/fixtures/asr/20260819T052831301Z-query-seedasr-duration-protocol-error-de477207',
				'002-recv-protocol-error.hex',
			),
		)
		expect(frame).toMatchObject({ kind: 'error', errorCode: 0x02aea540 })
		expect(frame.payloadText).toContain('body too short')
	})

	test.each([
		new Uint8Array(),
		Uint8Array.from([0x11, 0x10, 0x10, 0]),
		Uint8Array.from([0x11, 0x20, 0x10, 0, 0, 0, 0, 2, 1]),
		Uint8Array.from([0x11, 0x21, 0x10, 0, 0, 0, 0, 0]),
		Uint8Array.from([0x11, 0x20, 0x11, 0, 0, 0, 0, 0]),
		Uint8Array.from([0x11, 0x90, 0x10, 0, 0, 0, 0, 1]),
	])('rejects malformed frame %#', (bytes) => {
		expect(() => decodeFrame(bytes)).toThrow('Invalid SAUC frame')
	})

	test('does not mutate input payloads during encoding', () => {
		const source = Uint8Array.from([1, 2, 3])
		const result = encodeAudioFrame(source)
		expect(result.slice(8)).toEqual(source)
		source[0] = 9
		expect(result[8]).toBe(1)
	})

	test('encodes the sequence end frame with the signed sequence field', () => {
		const frame = encodeEndFrame(-12)
		expect(frame).toEqual(fixture(fixtureRoot, '011-send-end-neg-with-seq.hex'))
	})
})
