import { describe, expect, test } from 'vitest'
import { keyboardToggleButton } from '../src/controls/keyboard-controller'
import { defaultRow1, defaultRow2 } from '../src/toolbar/buttons'

describe('defaultRow1 (moshi-style single row)', () => {
	test('is exactly the 10-key high-frequency set in render order', () => {
		expect(defaultRow1.map((b) => b.id)).toEqual([
			'esc',
			'ctrl',
			'tab',
			'tmux-prefix',
			'up',
			'down',
			'enter',
			'paste',
			'keyboard-toggle',
			'drawer-toggle',
		])
	})

	test('starts with Esc', () => {
		expect(defaultRow1[0]?.label).toBe('Esc')
		expect(defaultRow1[0]?.action).toEqual({ type: 'send', data: '\x1b' })
	})

	test('has the sticky Ctrl modifier second', () => {
		expect(defaultRow1[1]?.id).toBe('ctrl')
		expect(defaultRow1[1]?.action).toEqual({ type: 'ctrl-modifier' })
	})

	test('has tmux Prefix button', () => {
		const prefix = defaultRow1.find((b) => b.id === 'tmux-prefix')
		expect(prefix).toBeDefined()
		expect(prefix?.action).toEqual({ type: 'prefix', data: '\x02' })
	})

	test('has only the Up/Down arrow keys', () => {
		const arrows = defaultRow1.filter(
			(b) =>
				b.action.type === 'send' && b.action.data.startsWith('\x1b[') && b.action.data !== '\x1b[Z',
		)
		expect(arrows.map((b) => b.id)).toEqual(['up', 'down'])
	})

	test('has Paste and ends with ⌨ then ☰ More', () => {
		const paste = defaultRow1.find((b) => b.action.type === 'paste')
		expect(paste?.label).toBe('Paste')
		expect(defaultRow1[defaultRow1.length - 2]).toEqual(keyboardToggleButton)
		const last = defaultRow1[defaultRow1.length - 1]
		expect(last?.action).toEqual({ type: 'drawer-toggle' })
		expect(last?.label).toContain('More')
	})
})

describe('defaultRow2', () => {
	test('is empty — the toolbar is a single row by default', () => {
		expect(defaultRow2).toEqual([])
	})
})
