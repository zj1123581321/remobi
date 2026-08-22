import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { NotifyEvent } from './events'

const EVENTS_FILE = 'events.jsonl'

/** Resolve per-port notify state directory under XDG_STATE_HOME. */
export function resolveNotifyStateDir(port: number): string {
	const base = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state')
	return join(base, 'herdweb', String(port))
}

export function ensureStateDir(stateDir: string): void {
	mkdirSync(stateDir, { recursive: true, mode: 0o700 })
	if (process.platform !== 'win32') {
		// Best-effort: tighten permissions on existing dirs.
		try {
			mkdirSync(stateDir, { mode: 0o700 })
		} catch {
			// ignore
		}
	}
}

/** Read JSON file; returns undefined when missing or unreadable. */
export function readJsonFile<T>(path: string): T | undefined {
	if (!existsSync(path)) return undefined
	try {
		return JSON.parse(readFileSync(path, 'utf-8')) as T
	} catch {
		return undefined
	}
}

/** Atomic JSON write via tmp+rename with explicit file mode. */
export function writeJsonFileAtomic(path: string, value: unknown, mode = 0o644): void {
	ensureStateDir(dirname(path))
	const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`
	writeFileSync(tmpPath, `${JSON.stringify(value)}\n`, { encoding: 'utf-8', mode })
	renameSync(tmpPath, path)
}

function trimEventsFile(stateDir: string, limit: number): void {
	const path = join(stateDir, EVENTS_FILE)
	if (!existsSync(path)) return
	try {
		const lines = readFileSync(path, 'utf-8')
			.split('\n')
			.filter((line) => line.length > 0)
		if (lines.length <= limit * 2) return
		const kept = lines.slice(-limit)
		writeFileSync(path, `${kept.join('\n')}\n`, { encoding: 'utf-8', mode: 0o644 })
	} catch {
		// File may have been removed between append and deferred trim.
	}
}

/** Append one event line; kind=test is a no-op. Trims when line count exceeds 2×limit. */
export function appendEventLine(stateDir: string, event: NotifyEvent, limit: number): void {
	if (event.kind === 'test') return
	ensureStateDir(stateDir)
	const path = join(stateDir, EVENTS_FILE)
	appendFileSync(path, `${JSON.stringify(event)}\n`, { encoding: 'utf-8', mode: 0o644 })
	setImmediate(() => trimEventsFile(stateDir, limit))
}

const LAST_SESSION_FILE = 'last-session.json'

export interface LastSessionEntry {
	readonly sessionId: string
	readonly exitedAt: number
	readonly exitCode: number
	readonly signal: number | null
}

export type LastSessionStore = Record<string, LastSessionEntry>

export function readLastSessionStore(stateDir: string): LastSessionStore {
	return readJsonFile<LastSessionStore>(join(stateDir, LAST_SESSION_FILE)) ?? {}
}

export function writeLastSessionStore(stateDir: string, store: LastSessionStore): void {
	writeJsonFileAtomic(join(stateDir, LAST_SESSION_FILE), store)
}

export function updateLastSessionEntry(
	stateDir: string,
	sessionKey: string,
	entry: LastSessionEntry,
): void {
	const store = readLastSessionStore(stateDir)
	store[sessionKey] = entry
	writeLastSessionStore(stateDir, store)
}
