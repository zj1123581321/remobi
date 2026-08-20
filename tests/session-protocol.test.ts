import { describe, expect, test } from 'vitest'
import {
	MAX_ACTION_ID_BYTES,
	MAX_CLIENT_INPUT_BYTES,
	MAX_RESIZE_COLS,
	MAX_RESIZE_ROWS,
	parseClientMessage,
	parseServerMessage,
	serialiseClientMessage,
	serialiseServerMessage,
} from '../src/session-protocol'

describe('session protocol', () => {
	test('round-trips input messages', () => {
		const message = { type: 'input' as const, data: 'ls\r' }
		expect(parseClientMessage(serialiseClientMessage(message))).toEqual(message)
	})

	test('round-trips input-action messages and validates UTF-8 ID size', () => {
		const message = { type: 'input-action' as const, id: 'action-1', data: 'echo hello\r' }
		expect(parseClientMessage(serialiseClientMessage(message))).toEqual(message)

		const maxSizedId = '😀'.repeat(MAX_ACTION_ID_BYTES / 4)
		expect(parseClientMessage(JSON.stringify({ type: 'ping', id: maxSizedId }))).toEqual({
			type: 'ping',
			id: maxSizedId,
		})
		expect(parseClientMessage(JSON.stringify({ type: 'ping', id: `${maxSizedId}😀` }))).toBeNull()
		expect(
			parseClientMessage(JSON.stringify({ type: 'input-action', id: '', data: 'x' })),
		).toBeNull()
	})

	test('requires ping IDs', () => {
		expect(parseClientMessage(JSON.stringify({ type: 'ping' }))).toBeNull()
		expect(parseClientMessage(JSON.stringify({ type: 'ping', id: 123 }))).toBeNull()
	})

	test('rejects malformed resize messages', () => {
		expect(parseClientMessage(JSON.stringify({ type: 'resize', cols: 80, rows: 0 }))).toBeNull()
		expect(parseClientMessage('{"type":"resize","cols":"80","rows":24}')).toBeNull()
	})

	test('rejects oversized input messages', () => {
		const oversized = 'x'.repeat(MAX_CLIENT_INPUT_BYTES + 1)
		expect(parseClientMessage(JSON.stringify({ type: 'input', data: oversized }))).toBeNull()
	})

	test('rejects oversized resize messages', () => {
		expect(
			parseClientMessage(JSON.stringify({ type: 'resize', cols: MAX_RESIZE_COLS + 1, rows: 24 })),
		).toBeNull()
		expect(
			parseClientMessage(JSON.stringify({ type: 'resize', cols: 80, rows: MAX_RESIZE_ROWS + 1 })),
		).toBeNull()
	})

	test('round-trips snapshot messages', () => {
		const message = {
			type: 'snapshot' as const,
			data: '\u001b[2Jhello',
			sessionId: 'session-1',
			outputWatermark: 3,
		}
		expect(parseServerMessage(serialiseServerMessage(message))).toEqual(message)
	})

	test('round-trips sequenced output and action responses', () => {
		const messages = [
			{ type: 'output' as const, data: 'hello', seq: 4 },
			{ type: 'pong' as const, id: 'ping-1' },
			{ type: 'input-accepted' as const, id: 'action-1' },
			{ type: 'input-rejected' as const, id: 'action-2', reason: 'id-conflict' as const },
		]

		for (const message of messages) {
			expect(parseServerMessage(serialiseServerMessage(message))).toEqual(message)
		}
	})

	test('rejects malformed new server message fields', () => {
		expect(parseServerMessage(JSON.stringify({ type: 'snapshot', data: 'x' }))).toBeNull()
		expect(
			parseServerMessage(
				JSON.stringify({ type: 'snapshot', data: 'x', sessionId: 's', outputWatermark: -1 }),
			),
		).toBeNull()
		expect(parseServerMessage(JSON.stringify({ type: 'output', data: 'x', seq: 0 }))).toBeNull()
		expect(parseServerMessage(JSON.stringify({ type: 'pong' }))).toBeNull()
		expect(
			parseServerMessage(JSON.stringify({ type: 'input-rejected', id: 'a', reason: 'unknown' })),
		).toBeNull()
	})

	test('rejects unknown server message types', () => {
		expect(parseServerMessage('{"type":"mystery"}')).toBeNull()
	})
})
