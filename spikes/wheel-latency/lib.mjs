import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { spawn } from 'node-pty'
// Session management mirrors spikes/scrollback/lib.mjs — same API, isolated session name.
import { ptyEnv } from '../scrollback/lib.mjs'

export const SESSION_NAME = 'spike-wheel'
export const SESSION_SOCKET = join(
	process.env.HOME ?? '',
	'.config/herdr/sessions',
	SESSION_NAME,
	'herdr.sock',
)
export const ARTIFACTS_DIR = join(tmpdir(), 'spike-wheel-latency-captures')

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
		this.cwd = mkdtempSync(join(tmpdir(), 'spike-wheel-'))
		this.events = []
		this.exited = false
		this.pty = spawn('herdr', ['--session', SESSION_NAME], {
			name: 'xterm-256color',
			cols,
			rows,
			cwd: this.cwd,
			env: ptyEnv(process.env),
		})
		this.pty.onData((data) => {
			this.events.push({ type: 'data', t: Date.now(), data, bytes: data.length })
		})
		this.pty.onExit(() => {
			this.exited = true
		})
	}

	write(text) {
		this.pty.write(text)
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

	async runInPane(pane, command, marker, timeoutMs = 180000) {
		const splitMarker = `${marker.slice(0, 3)}""${marker.slice(3)}`
		this.sendText(pane, `${command}; echo ${splitMarker}\n`)
		await this.waitFor(() => this.paneRead(pane).includes(marker), {
			timeoutMs,
			what: `pane marker ${marker}`,
		})
		await sleep(500)
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
			// session absent
		}
	}
}

export async function startCleanSession(opts = {}) {
	await stopSession()
	const cap = new HerdrCapture(opts)
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
		// best-effort
	}
}
