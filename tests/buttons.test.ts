import { describe, expect, test } from 'vitest'
import { dpadToggleButton } from '../src/controls/dpad'
import { keyboardToggleButton } from '../src/controls/keyboard-controller'
import { defaultRow1, defaultRow2 } from '../src/toolbar/buttons'

describe('defaultRow1 (moshi-style single row)', () => {
	test('is exactly the 8-key high-frequency set in render order', () => {
		expect(defaultRow1.map((b) => b.id)).toEqual([
			'esc',
			'ctrl-c',
			'backspace',
			'enter',
			'dpad-toggle',
			'keyboard-toggle',
			'image-upload',
			'drawer-toggle',
		])
	})

	test('starts with Esc', () => {
		expect(defaultRow1[0]?.label).toBe('Esc')
		expect(defaultRow1[0]?.action).toEqual({ type: 'send', data: '\x1b' })
	})

	test('has a dedicated C-c second — double-tap quits coding agents', () => {
		expect(defaultRow1[1]?.id).toBe('ctrl-c')
		expect(defaultRow1[1]?.action).toEqual({ type: 'send', data: '\x03' })
	})

	test('keeps ⏎ on the row — the primary send key never moves into a submenu', () => {
		const enter = defaultRow1.find((b) => b.id === 'enter')
		expect(enter?.action).toEqual({ type: 'send', data: '\r' })
	})

	test('has ⌫ Backspace third (\\x7f) — Tab moved to the drawer', () => {
		const backspace = defaultRow1[2]
		expect(backspace?.id).toBe('backspace')
		expect(backspace?.action).toEqual({ type: 'send', data: '\x7f' })
	})

	test('has no arrow keys — the floating d-pad (✥) owns them now', () => {
		const arrows = defaultRow1.filter(
			(b) =>
				b.action.type === 'send' && b.action.data.startsWith('\x1b[') && b.action.data !== '\x1b[Z',
		)
		expect(arrows).toEqual([])
		const dpad = defaultRow1.find((b) => b.id === 'dpad-toggle')
		expect(dpad).toEqual(dpadToggleButton)
	})

	test('ends with ⌨ then 🖼 then ☰ More', () => {
		expect(defaultRow1[defaultRow1.length - 3]).toEqual(keyboardToggleButton)
		expect(defaultRow1[defaultRow1.length - 2]?.action).toEqual({ type: 'image-upload' })
		const last = defaultRow1[defaultRow1.length - 1]
		expect(last?.action).toEqual({ type: 'drawer-toggle' })
		expect(last?.label).toContain('More')
	})

	test('keeps the sticky Ctrl, Prefix and Paste off the row', () => {
		expect(defaultRow1.find((b) => b.action.type === 'ctrl-modifier')).toBeUndefined()
		expect(defaultRow1.find((b) => b.action.type === 'prefix')).toBeUndefined()
		expect(defaultRow1.find((b) => b.action.type === 'paste')).toBeUndefined()
	})
})

describe('defaultRow2', () => {
	test('is empty — the toolbar is a single row by default', () => {
		expect(defaultRow2).toEqual([])
	})
})
