import { describe, expect, test } from 'vitest'
import { defaultDrawerButtons } from '../src/drawer/commands'

describe('defaultDrawerButtons', () => {
	test('has 31 commands', () => {
		expect(defaultDrawerButtons).toHaveLength(31)
	})

	test('all commands have id, label, description, and action', () => {
		for (const cmd of defaultDrawerButtons) {
			expect(cmd.id).toBeTruthy()
			expect(cmd.label).toBeTruthy()
			expect(cmd.description).toBeTruthy()
			expect(cmd.action).toBeTruthy()
		}
	})

	test('tmux commands send tmux prefix (Ctrl-b); raw key sends do not', () => {
		for (const cmd of defaultDrawerButtons) {
			if (cmd.action.type !== 'send') continue
			if (cmd.id.startsWith('tmux-')) {
				expect(cmd.action.data.startsWith('\x02')).toBe(true)
			} else {
				// Scroll keys and the keys relocated from the single-row toolbar
				// are app-level raw sends (no tmux prefix).
				expect(cmd.action.data.startsWith('\x02')).toBe(false)
			}
		}
	})

	test('includes window management commands', () => {
		const labels = defaultDrawerButtons.map((c) => c.label)
		expect(labels).toContain('+ Win')
		expect(labels).toContain('Split |')
		expect(labels).toContain('Zoom')
		expect(labels).toContain('Kill')
	})

	test('includes navigation commands', () => {
		const labels = defaultDrawerButtons.map((c) => c.label)
		expect(labels).toContain('Sessions')
		expect(labels).toContain('Windows')
	})

	test('uses stock tmux bindings for split/session/window/copy actions', () => {
		const byId = new Map(defaultDrawerButtons.map((button) => [button.id, button]))

		expect(byId.get('tmux-split-vertical')?.action).toEqual({ type: 'send', data: '\x02%' })
		expect(byId.get('tmux-split-horizontal')?.action).toEqual({ type: 'send', data: '\x02"' })
		expect(byId.get('tmux-sessions')?.action).toEqual({ type: 'send', data: '\x02s' })
		expect(byId.get('tmux-windows')?.action).toEqual({ type: 'send', data: '\x02w' })
		expect(byId.get('tmux-copy')?.action).toEqual({ type: 'send', data: '\x02[' })
	})

	test('includes scroll commands', () => {
		const labels = defaultDrawerButtons.map((c) => c.label)
		expect(labels).toContain('PgUp')
		expect(labels).toContain('PgDn')
	})

	test('does not include opinionated popup workflow buttons', () => {
		const ids = defaultDrawerButtons.map((button) => button.id)
		expect(ids).not.toContain('tmux-git')
		expect(ids).not.toContain('tmux-files')
		expect(ids).not.toContain('tmux-links')
	})

	test('includes combo sender command', () => {
		const combo = defaultDrawerButtons.find((button) => button.id === 'combo-picker')
		expect(combo).toBeDefined()
		expect(combo?.action).toEqual({ type: 'combo-picker' })
	})

	test('includes font size and guide controls moved from the floating cluster', () => {
		const byId = new Map(defaultDrawerButtons.map((button) => [button.id, button]))

		expect(byId.get('font-decrease')?.label).toBe('Font −')
		expect(byId.get('font-decrease')?.action).toEqual({ type: 'font-size', delta: -2 })
		expect(byId.get('font-increase')?.label).toBe('Font +')
		expect(byId.get('font-increase')?.action).toEqual({ type: 'font-size', delta: 2 })
		// 'Guide' — must not clash with tmux-help's 'Help' label
		expect(byId.get('guide')?.label).toBe('Guide')
		expect(byId.get('guide')?.action).toEqual({ type: 'help' })
		expect(byId.get('tmux-help')?.label).toBe('Help')
	})

	test('keeps the keys removed from the single-row toolbar reachable', () => {
		const byId = new Map(defaultDrawerButtons.map((button) => [button.id, button]))

		expect(byId.get('shift-tab')?.action).toEqual({
			type: 'send',
			data: '\x1b[Z',
			keyLabel: 'Shift+Tab',
		})
		expect(byId.get('left')?.action).toEqual({ type: 'send', data: '\x1b[D', keyLabel: 'Left' })
		expect(byId.get('right')?.action).toEqual({ type: 'send', data: '\x1b[C', keyLabel: 'Right' })
		// up/down fell off row1 when the d-pad took over the arrows — drawer fallback
		expect(byId.get('up')?.action).toEqual({ type: 'send', data: '\x1b[A', keyLabel: 'Up' })
		expect(byId.get('down')?.action).toEqual({ type: 'send', data: '\x1b[B', keyLabel: 'Down' })
		expect(byId.get('ctrl-c')?.action).toEqual({ type: 'send', data: '\x03' })
		expect(byId.get('ctrl-d')?.action).toEqual({ type: 'send', data: '\x04' })
		expect(byId.get('q')?.action).toEqual({ type: 'send', data: 'q' })
		expect(byId.get('alt-enter')?.action).toEqual({
			type: 'send',
			data: '\x1b\r',
			keyLabel: 'Alt+Enter',
		})
		expect(byId.get('space')?.action).toEqual({ type: 'send', data: ' ' })
		expect(byId.get('backspace')?.action).toEqual({
			type: 'send',
			data: '\x7f',
			keyLabel: 'Backspace',
		})
		expect(byId.get('ctrl')?.action).toEqual({ type: 'ctrl-modifier' })
		expect(byId.get('tmux-prefix')?.action).toEqual({ type: 'prefix', data: '\x02' })
		expect(byId.get('paste')?.action).toEqual({ type: 'paste' })
	})
})
