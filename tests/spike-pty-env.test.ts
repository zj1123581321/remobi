import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, test } from 'vitest'

type PtyEnvFn = (sourceEnv: Record<string, string>) => Record<string, string>

async function loadPtyEnv(): Promise<PtyEnvFn> {
	const url = pathToFileURL(join(process.cwd(), 'spikes/scrollback/lib.mjs')).href
	const mod = (await import(url)) as { ptyEnv: PtyEnvFn }
	return mod.ptyEnv
}

describe('spike scrollback ptyEnv', () => {
	test('strips TMUX/ZELLIJ/HERDR-prefixed vars including unknown HERDR_* names', async () => {
		const ptyEnv = await loadPtyEnv()
		const source = {
			HERDR_ENV: 'nested-session-env',
			HERDR_SOCKET_PATH: '/home/user/.config/herdr/herdr.sock',
			HERDR_SOME_FUTURE_VAR: 'must-not-leak',
			TMUX: '1',
			TMUX_PANE: '%0',
			ZELLIJ_SESSION_NAME: 'main',
			PATH: '/usr/bin',
			HOME: '/home/user',
		}

		const result = ptyEnv(source)

		expect(result).not.toHaveProperty('HERDR_ENV')
		expect(result).not.toHaveProperty('HERDR_SOCKET_PATH')
		expect(result).not.toHaveProperty('HERDR_SOME_FUTURE_VAR')
		expect(result).not.toHaveProperty('TMUX')
		expect(result).not.toHaveProperty('TMUX_PANE')
		expect(result).not.toHaveProperty('ZELLIJ_SESSION_NAME')
		expect(result.PATH).toBe('/usr/bin')
		expect(result.HOME).toBe('/home/user')
		expect(result.TERM).toBe('xterm-256color')
	})
})
