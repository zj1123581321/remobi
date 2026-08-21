import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import XtermHeadless from '@xterm/headless'
// Spike library: capture an isolated herdr session via node-pty, replay into a
// headless xterm mirror (same config as src/session.ts), reconstruct scrollback
// from frame diffs. Probe-only — never imported by production.
import { spawn } from 'node-pty'

export const SESSION_NAME = 'spike-scrollback'
export const SESSION_SOCKET = join(
	process.env.HOME ?? '',
	'.config/herdr/sessions',
	SESSION_NAME,
	'herdr.sock',
)
// Artifacts and raw captures are probe output — they stay OUT of the repo
// (biome would demand pretty-printed JSON; the evidence doc inlines the
// numbers and rerunning regenerates everything).
export const ARTIFACTS_DIR = join(tmpdir(), 'spike-scrollback-captures')
export const CAPTURE_DIR = ARTIFACTS_DIR

const NESTED_MUX_ENV_VARS = new Set([
	'TMUX',
	'TMUX_PANE',
	'ZELLIJ',
	'ZELLIJ_PANE_ID',
	'ZELLIJ_SESSION_NAME',
	'HERDR_SESSION',
	'HERDR_SOCKET_PATH',
	'HERDR_PANE_ID',
	'HERDR_TAB_ID',
	'HERDR_WORKSPACE_ID',
])

// Mirrors buildSessionEnv() from src/session.ts.
export function ptyEnv(sourceEnv) {
	const rest = Object.fromEntries(
		Object.entries(sourceEnv).filter(([key]) => !NESTED_MUX_ENV_VARS.has(key)),
	)
	return { ...rest, TERM: 'xterm-256color' }
}

// Every CLI call is pinned to OUR session socket — the user's session can
// never be reached from this probe.
export function herdrCli(args, timeoutMs = 30000) {
	return execFileSync('herdr', args, {
		encoding: 'utf8',
		timeout: timeoutMs,
		env: { ...process.env, HERDR_SOCKET_PATH: SESSION_SOCKET },
	})
}

export class HerdrCapture {
	constructor({ cols = 80, rows = 24 } = {}) {
		this.cols = cols
		this.rows = rows
		this.cwd = mkdtempSync(join(tmpdir(), 'spike-scrollback-'))
		this.events = []
		this.marks = []
		this.exited = false
		this.pty = spawn('herdr', ['--session', SESSION_NAME], {
			name: 'xterm-256color',
			cols,
			rows,
			cwd: this.cwd,
			env: ptyEnv(process.env),
		})
		this.pty.onData((data) => {
			this.events.push({ type: 'data', t: Date.now(), data })
		})
		this.pty.onExit(() => {
			this.exited = true
		})
	}

	mark(label) {
		this.marks.push({ label, eventIndex: this.events.length })
		return this.events.length
	}

	write(text) {
		this.pty.write(text)
	}

	resize(cols, rows) {
		this.cols = cols
		this.rows = rows
		this.events.push({ type: 'resize', t: Date.now(), cols, rows })
		this.pty.resize(cols, rows)
	}

	sendText(pane, text) {
		herdrCli(['pane', 'send-text', pane, text])
	}

	paneRead(pane) {
		return herdrCli(['pane', 'read', pane, '--source', 'recent'], 15000)
	}

	async waitFor(predicate, { timeoutMs = 15000, intervalMs = 200, what = 'condition' } = {}) {
		const deadline = Date.now() + timeoutMs
		for (;;) {
			if (predicate()) return true
			if (Date.now() > deadline) throw new Error(`timeout waiting for ${what}`)
			await sleep(intervalMs)
		}
	}

	// herdr 0.7.5's `pane wait-output` mis-parses --match values, so marker
	// synchronisation polls `pane read` instead. The echoed marker is split
	// with "" in the typed command so pane-read cannot false-match the echo.
	async runInPane(pane, command, marker, timeoutMs = 180000) {
		this.mark(`run:${marker}`)
		const splitMarker = `${marker.slice(0, 3)}""${marker.slice(3)}`
		this.sendText(pane, `${command}; echo ${splitMarker}\n`)
		await this.waitFor(() => this.paneRead(pane).includes(marker), {
			timeoutMs,
			what: `pane marker ${marker}`,
		})
		await sleep(500)
	}

	saveCapture(name) {
		mkdirSync(CAPTURE_DIR, { recursive: true })
		const path = join(CAPTURE_DIR, `${name}.events.json`)
		writeFileSync(path, JSON.stringify({ marks: this.marks, events: this.events }))
		return path
	}

	async killPty() {
		if (!this.exited) {
			this.pty.kill()
			await this.waitFor(() => this.exited, { timeoutMs: 8000, what: 'pty exit' })
		}
	}
}

export async function stopSession() {
	for (const args of [
		['session', 'stop', SESSION_NAME],
		['session', 'delete', SESSION_NAME],
	]) {
		try {
			herdrCli(args, 15000)
		} catch {
			// session absent — nothing to clean
		}
	}
}

export async function startCleanSession(opts = {}) {
	await stopSession()
	const cap = new HerdrCapture(opts)
	// herdr draws the workspace cell-by-cell, so raw text never appears
	// contiguously — wait for the alternate-screen enter sequence instead.
	await cap.waitFor(
		() => cap.events.some((e) => e.type === 'data' && e.data.includes('\x1b[?1049h')),
		{ what: 'herdr alternate screen enter', timeoutMs: 30000 },
	)
	await sleep(1500)
	await cap.waitFor(
		() => {
			try {
				return cap.paneRead('w1:p1').length > 0
			} catch {
				return false
			}
		},
		{ what: 'pane w1:p1 readable' },
	)
	await sleep(800)
	return cap
}

export async function teardown(cap) {
	await cap.killPty().catch(() => {})
	await stopSession()
	try {
		rmSync(cap.cwd, { recursive: true, force: true })
	} catch {
		// temp dir cleanup is best-effort
	}
}

function snapshot(term, eventIndex) {
	const buf = term.buffer.active
	const lines = []
	for (let r = 0; r < term.rows; r++) {
		lines.push(buf.getLine(r)?.translateToString(true) ?? '')
	}
	return { eventIndex, kind: 'data', cols: term.cols, rows: term.rows, bufType: buf.type, lines }
}

export async function replayFrames(events, { cols = 80, rows = 24 } = {}) {
	const term = new XtermHeadless.Terminal({
		allowProposedApi: true,
		cols,
		rows,
		scrollback: 5000,
	})
	const frames = []
	for (const [i, ev] of events.entries()) {
		if (ev.type === 'resize') {
			term.resize(ev.cols, ev.rows)
			frames.push({ eventIndex: i, kind: 'resize', cols: ev.cols, rows: ev.rows })
			continue
		}
		await new Promise((resolve) => term.write(ev.data, resolve))
		frames.push(snapshot(term, i))
	}
	return frames
}

// Slice one screen row down to the content region; strip a leading pane-border
// glyph (the border column is not perfectly aligned across chrome rows).
export function sliceLine(line, region) {
	const sliced = line.slice(region.c0, region.c1 + 1).trimEnd()
	return sliced.startsWith('│') ? sliced.slice(1) : sliced
}

// Minimal n>0 such that region content of curr equals prev shifted up by n
// (k = height-n comparable rows, bounded via minK). Any mismatch → null; an
// all-blank match is not accepted.
export function tryAlign(prevLines, currLines, region, minK) {
	const height = region.r1 - region.r0 + 1
	const maxN = height - minK
	for (let n = 1; n <= maxN; n++) {
		let ok = true
		let nonBlank = 0
		for (let j = 0; j + n < height; j++) {
			const a = sliceLine(currLines[region.r0 + j] ?? '', region)
			const b = sliceLine(prevLines[region.r0 + j + n] ?? '', region)
			if (a !== b) {
				ok = false
				break
			}
			if (a.trim() !== '') nonBlank++
		}
		if (ok && nonBlank > 0) return n
	}
	return null
}

// Chrome strips sit just outside the region (tab strip above, sidebar left).
// When a guarded strip changes, the pair is a layout/selection change, not a
// scroll → baseline resets, nothing appended. Guards are learned during
// calibration: only strips CONSTANT across the calibration window are watched.
function chromeSignature(lines, region, guards) {
	const top = guards.top ? (lines[region.r0 - 1] ?? '').trimEnd() : ''
	const left = []
	if (guards.left) {
		for (let r = region.r0; r <= region.r1; r++) {
			left.push((lines[r] ?? '').slice(0, region.c0).trimEnd())
		}
	}
	return `${top}\n${left.join('\n')}`
}

export function learnGuards(calFrames, region) {
	const constant = (get) => {
		if (calFrames.length === 0) return false
		const first = get(calFrames[0])
		return calFrames.every((f) => get(f) === first)
	}
	return {
		top: constant((f) => (f.lines[region.r0 - 1] ?? '').trimEnd()),
		left: constant((f) =>
			f.lines
				.slice(region.r0, region.r1 + 1)
				.map((l) => l.slice(0, region.c0).trimEnd())
				.join('\n'),
		),
	}
}

function identical(a, b) {
	return a.length === b.length && a.every((line, i) => line === b[i])
}

export function analyzeScroll(
	frames,
	region,
	{ minK, fromEventIndex = 0, guards = { top: false, left: false } } = {},
) {
	const history = []
	const stat = {
		dataFrames: 0,
		sameFrames: 0,
		scrolls: 0,
		scrollLines: 0,
		skippedUnaligned: 0,
		skippedChrome: 0,
		resets: 0,
	}
	const shiftHist = new Map()
	let prev = null
	for (const f of frames) {
		if (f.kind === 'resize') {
			stat.resets++
			prev = null
			continue
		}
		if (f.eventIndex < fromEventIndex || !prev) {
			prev = f
			continue
		}
		if (prev.rows !== f.rows || prev.cols !== f.cols || prev.bufType !== f.bufType) {
			stat.resets++
			prev = f
			continue
		}
		if (identical(prev.lines, f.lines)) {
			stat.sameFrames++
			prev = f
			continue
		}
		stat.dataFrames++
		if (chromeSignature(prev.lines, region, guards) !== chromeSignature(f.lines, region, guards)) {
			stat.skippedChrome++
			prev = f
			continue
		}
		const n = tryAlign(prev.lines, f.lines, region, minK)
		if (n === null) {
			stat.skippedUnaligned++
			prev = f
			continue
		}
		stat.scrolls++
		stat.scrollLines += n
		shiftHist.set(n, (shiftHist.get(n) ?? 0) + 1)
		for (let j = 0; j < n; j++) {
			history.push(sliceLine(prev.lines[region.r0 + j] ?? '', region))
		}
		prev = f
	}
	return {
		history,
		stat,
		shiftHist: Object.fromEntries([...shiftHist.entries()].sort((a, b) => a[0] - b[0])),
	}
}

function pairScore(pairs, region, minK) {
	let score = 0
	for (const [prev, curr] of pairs) {
		const n = tryAlign(prev.lines, curr.lines, region, minK)
		if (n !== null) score += n
	}
	return score
}

function dataPairs(frames, maxPairs) {
	const pairs = []
	for (let i = 1; i < frames.length && pairs.length < maxPairs; i++) {
		const a = frames[i - 1]
		const b = frames[i]
		if (a.kind !== 'data' || b.kind !== 'data') continue
		if (a.rows !== b.rows || a.cols !== b.cols || a.bufType !== b.bufType) continue
		if (identical(a.lines, b.lines)) continue
		// Blank startup screens align trivially anywhere — require content.
		const dense = (f) => f.lines.filter((l) => l.trim() !== '').length >= f.lines.length / 2
		if (!dense(a) || !dense(b)) continue
		pairs.push([a, b])
	}
	return pairs
}

// Passive region discovery. The four edges poison each other (sidebar, tab
// strip, status bar, scrollbar column each zero the score when included), so
// plain coordinate descent cannot bootstrap. Strategy: (A) coarse column grid
// with neutral row bounds finds a positive seed; (B/C) each edge walks from
// its argmax toward more content while the score stays positive — the
// chrome/content boundary shows up as a sharp zero. Score magnitudes inside
// the content are noisy, so only the zero-boundary is trusted.
export function calibrateRegion(frames, { minK, maxPairs = 60 } = {}) {
	const rows = frames.find((f) => f.kind === 'data')?.rows ?? 24
	const cols = frames.find((f) => f.kind === 'data')?.cols ?? 80
	const pairs = dataPairs(frames, maxPairs)
	const scoreOf = (region) => pairScore(pairs, region, minK)
	const bestOf = (cands, score) => cands.reduce((a, b) => (score(b) > score(a) ? b : a), cands[0])
	// (A) coarse column grid, neutral rows — find a positive seed
	const coarseC0 = [...Array(Math.ceil(cols / 5)).keys()].map((k) => k * 5)
	const seed = bestOf(
		coarseC0.flatMap((c0) => [cols - 2, cols - 1].map((c1) => ({ c0, c1 }))),
		(v) => scoreOf({ r0: 1, r1: rows - 2, ...v }),
	)
	const region = { r0: 1, r1: rows - 2, c0: seed.c0, c1: seed.c1 }
	// (B) row edges: top walks from argmax toward content while score stays
	// positive; bottom trusts the argmax alone (status row kills alignment).
	const rowScore = (r0, r1) => scoreOf({ r0, r1, c0: region.c0, c1: region.c1 })
	let r0 = bestOf([0, 1, 2, 3], (b) => rowScore(b, region.r1))
	while (r0 > 0 && rowScore(r0 - 1, region.r1) > 0) r0--
	const r1 = bestOf([rows - 4, rows - 3, rows - 2, rows - 1], (b) => rowScore(r0, b))
	// (C) column edges: same walk pattern.
	const colScore = (c0, c1) => scoreOf({ r0, r1, c0, c1 })
	let c0 = bestOf([region.c0, ...Array(Math.floor(cols / 2)).keys()], (b) => colScore(b, region.c1))
	while (c0 > 0 && colScore(c0 - 1, region.c1) > 0) c0--
	let c1 = bestOf([cols - 5, cols - 4, cols - 3, cols - 2, cols - 1], (b) => colScore(c0, b))
	while (c1 < cols - 1 && colScore(c0, c1 + 1) > 0) c1++
	// Trim columns constant across both frames and rows — pure chrome (e.g.
	// the pane border "│") must not leak into history lines.
	const found = { r0, r1, c0, c1 }
	const colConstant = (c) => {
		const strips = frames.map((f) =>
			f.lines
				.slice(found.r0, found.r1 + 1)
				.map((l) => l[c] ?? ' ')
				.join(''),
		)
		const acrossRows = strips[0].split('').every((ch) => ch === strips[0][0])
		return acrossRows && strips.every((s) => s === strips[0])
	}
	const trimmed = { ...found }
	while (trimmed.c0 < trimmed.c1 && colConstant(trimmed.c0)) trimmed.c0++
	while (trimmed.c1 > trimmed.c0 && colConstant(trimmed.c1)) trimmed.c1--
	return { region: trimmed, pairs: pairs.length }
}

// Extract /^\d+$/ lines and verify strict +1 continuity; non-digit lines are
// reported as junk — for the seq scenario any junk is an error insertion.
export function validateNumberSequence(history) {
	const numbers = []
	const junk = []
	for (const line of history) {
		const m = line.match(/^[^A-Za-z0-9]*(\d+)\s*$/)
		if (m) numbers.push(Number(m[1]))
		else junk.push(line)
	}
	const problems = { missing: [], duplicated: [], disordered: [] }
	for (let i = 1; i < numbers.length; i++) {
		const d = numbers[i] - numbers[i - 1]
		if (d === 1) continue
		if (d > 1) problems.missing.push({ after: numbers[i - 1], gap: d - 1 })
		else if (d === 0) problems.duplicated.push(numbers[i])
		else problems.disordered.push({ from: numbers[i - 1], to: numbers[i] })
	}
	return {
		count: numbers.length,
		first: numbers[0],
		last: numbers[numbers.length - 1],
		problems,
		junk,
	}
}

// Control characters in regex literals trip noControlCharactersInRegex, so
// the alternate-screen sequences are counted by plain string splitting.
const countOccurrences = (haystack, needle) =>
	haystack.length ? haystack.split(needle).length - 1 : 0

export function altScreenUsage(events) {
	const raw = events
		.filter((e) => e.type === 'data')
		.map((e) => e.data)
		.join('')
	return {
		enterCount: countOccurrences(raw, '\x1b[?1049h'),
		exitCount: countOccurrences(raw, '\x1b[?1049l'),
		mouseEncoding: raw.includes('\x1b[?1006h'),
		sample: raw.includes('\x1b[?1049h') ? '\\x1b[?1049h present in raw stream' : 'absent',
	}
}
