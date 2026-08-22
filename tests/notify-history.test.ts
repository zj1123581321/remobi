import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
	clampHistoryLimit,
	HISTORY_DEFAULT_LIMIT,
	HISTORY_MAX_LIMIT,
	HISTORY_MIN_LIMIT,
	parseHistoryLimitParam,
	readEventHistory,
} from '../src/notify/history'
import { appendEventLine } from '../src/notify/state'

const validBase = {
	v: 1,
	id: 'evt-1',
	kind: 'asking' as const,
	title: 'Need input',
	ts: 1_700_000_000,
}

describe('clampHistoryLimit', () => {
	test('defaults non-finite to 50', () => {
		expect(clampHistoryLimit(NaN)).toBe(HISTORY_DEFAULT_LIMIT)
		expect(clampHistoryLimit(Number.POSITIVE_INFINITY)).toBe(HISTORY_DEFAULT_LIMIT)
	})

	test('clamps below minimum to 1', () => {
		expect(clampHistoryLimit(0)).toBe(HISTORY_MIN_LIMIT)
		expect(clampHistoryLimit(-10)).toBe(HISTORY_MIN_LIMIT)
	})

	test('clamps above maximum to 500', () => {
		expect(clampHistoryLimit(1000)).toBe(HISTORY_MAX_LIMIT)
		expect(clampHistoryLimit(501)).toBe(HISTORY_MAX_LIMIT)
	})

	test('floors fractional values', () => {
		expect(clampHistoryLimit(3.9)).toBe(3)
	})
})

describe('parseHistoryLimitParam', () => {
	test('defaults missing param to 50', () => {
		expect(parseHistoryLimitParam(undefined)).toBe(HISTORY_DEFAULT_LIMIT)
		expect(parseHistoryLimitParam('')).toBe(HISTORY_DEFAULT_LIMIT)
	})

	test('clamps out-of-range query values', () => {
		expect(parseHistoryLimitParam('0')).toBe(HISTORY_MIN_LIMIT)
		expect(parseHistoryLimitParam('999')).toBe(HISTORY_MAX_LIMIT)
		expect(parseHistoryLimitParam('abc')).toBe(HISTORY_DEFAULT_LIMIT)
	})
})

describe('readEventHistory', () => {
	let stateDir: string | undefined

	afterEach(() => {
		if (stateDir) rmSync(stateDir, { recursive: true, force: true })
		stateDir = undefined
	})

	test('returns empty array for missing file', () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-history-'))
		expect(readEventHistory(stateDir, 50)).toEqual([])
	})

	test('returns empty array for empty file', () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-history-'))
		writeFileSync(join(stateDir, 'events.jsonl'), '')
		expect(readEventHistory(stateDir, 50)).toEqual([])
	})

	test('returns newest-first tail events', () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-history-'))
		for (let i = 0; i < 5; i++) {
			appendEventLine(
				stateDir,
				{ ...validBase, id: `e${i}`, kind: 'done', title: `t${i}`, ts: i },
				200,
			)
		}
		const events = readEventHistory(stateDir, 3)
		expect(events).toHaveLength(3)
		expect(events.map((e) => e.id)).toEqual(['e4', 'e3', 'e2'])
	})

	test('does not include test kind events', () => {
		stateDir = mkdtempSync(join(tmpdir(), 'herdweb-notify-history-'))
		appendEventLine(stateDir, { ...validBase, id: 'real', kind: 'done' }, 200)
		const path = join(stateDir, 'events.jsonl')
		const lines = readFileSync(path, 'utf-8').trim().split('\n')
		writeFileSync(
			path,
			`${lines.join('\n')}\n${JSON.stringify({ v: 1, id: '', kind: 'test', title: 'skip', ts: 1 })}\n`,
		)
		const events = readEventHistory(stateDir, 50)
		expect(events).toHaveLength(1)
		expect(events[0]?.id).toBe('real')
	})
})
