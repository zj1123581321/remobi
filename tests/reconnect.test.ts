import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setupReconnect } from '../src/reconnect'
import type { ConnectionStatus, XTerminal } from '../src/types'

function mockConnectionTerminal(
	initial: ConnectionStatus = {
		state: 'disconnected',
		consecutivePreSyncFailures: 0,
		lastFailureReason: null,
	},
): XTerminal & { setStatus(status: ConnectionStatus): void; reconnectCalls: number } {
	let status = initial
	const listeners = new Set<(next: ConnectionStatus) => void>()
	const term = {
		reconnectCalls: 0,
		options: { fontSize: 14 },
		input() {},
		focus() {},
		onData() {
			return { dispose() {} }
		},
		isConnected: () => status.state === 'synced',
		onConnectionChange() {
			return { dispose() {} }
		},
		getConnectionStatus: () => status,
		onConnectionStatusChange(handler: (next: ConnectionStatus) => void) {
			listeners.add(handler)
			handler(status)
			return { dispose: () => listeners.delete(handler) }
		},
		requestReconnect() {
			term.reconnectCalls += 1
		},
		setStatus(next: ConnectionStatus) {
			status = next
			for (const listener of listeners) listener(status)
		},
	}
	return term
}

function getOverlay(): HTMLElement | null {
	return document.getElementById('remobi-reconnect-overlay')
}

beforeEach(() => {
	GlobalRegistrator.register()
})

afterEach(() => {
	// Clean up any overlay left behind
	getOverlay()?.remove()
	window.__remobiSockets = undefined
	GlobalRegistrator.unregister()
})

describe('setupReconnect', () => {
	test('renders the disconnected state immediately', () => {
		const dispose = setupReconnect(mockConnectionTerminal(), { enabled: true })
		const overlay = getOverlay()
		expect(overlay).not.toBeNull()
		expect(overlay?.style.display).toBe('flex')
		expect(overlay?.dataset.connectionState).toBe('disconnected')
		expect(overlay?.querySelector('div')?.textContent).toBe('Disconnected')
		dispose()
	})

	test.each([
		['reconnecting', 'Reconnecting…'],
		['syncing', 'Syncing…'],
		['synced', 'Synced'],
	] as const)('renders the %s state', (state, text) => {
		const term = mockConnectionTerminal()
		const dispose = setupReconnect(term, { enabled: true })
		term.setStatus({ state, consecutivePreSyncFailures: 0, lastFailureReason: null })
		const overlay = getOverlay()
		expect(overlay?.dataset.connectionState).toBe(state)
		expect(overlay?.querySelector('div')?.textContent).toBe(text)
		expect(overlay?.style.display).toBe(state === 'synced' ? 'none' : 'flex')
		dispose()
	})

	test('disabled mode does not render an overlay', () => {
		const dispose = setupReconnect(mockConnectionTerminal(), { enabled: false })
		expect(getOverlay()).toBeNull()
		dispose()
	})

	test('dispose removes overlay from DOM', () => {
		const dispose = setupReconnect(mockConnectionTerminal(), { enabled: true })
		expect(getOverlay()).not.toBeNull()
		dispose()
		expect(getOverlay()).toBeNull()
	})

	test('overlay contains reconnect button', () => {
		const dispose = setupReconnect(mockConnectionTerminal(), { enabled: true })
		const overlay = getOverlay()
		const buttons = [...(overlay?.querySelectorAll('button') ?? [])]
		expect(buttons.map((button) => button.textContent)).toEqual(['立即重试', '重新认证'])
		dispose()
	})

	test('clicking immediate retry forwards once', () => {
		const term = mockConnectionTerminal()
		const dispose = setupReconnect(term, { enabled: true })
		const button = getOverlay()?.querySelector('button')
		button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		expect(term.reconnectCalls).toBe(1)
		dispose()
	})

	test('clicking overlay backdrop forwards immediate retry once', () => {
		const term = mockConnectionTerminal()
		const dispose = setupReconnect(term, { enabled: true })
		getOverlay()?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		expect(term.reconnectCalls).toBe(1)
		dispose()
	})

	test('clicking overlay message forwards immediate retry once', () => {
		const term = mockConnectionTerminal()
		const dispose = setupReconnect(term, { enabled: true })
		const message = getOverlay()?.querySelector('div')
		message?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		expect(term.reconnectCalls).toBe(1)
		dispose()
	})

	test('multiple immediate retry triggers are forwarded', () => {
		const term = mockConnectionTerminal()
		const dispose = setupReconnect(term, { enabled: true })
		const overlay = getOverlay()
		overlay?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		overlay?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		expect(term.reconnectCalls).toBe(2)
		dispose()
	})

	test('auth hint shows refresh action after three failures', () => {
		const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
		const term = mockConnectionTerminal()
		const dispose = setupReconnect(term, { enabled: true })
		term.setStatus({
			state: 'reconnecting',
			consecutivePreSyncFailures: 3,
			lastFailureReason: 'socket-closed',
		})
		const buttons = [...(getOverlay()?.querySelectorAll('button') ?? [])]
		expect(getOverlay()?.querySelector('div')?.textContent).toBe(
			'Connection failed — you may need to re-authenticate.',
		)
		expect(buttons[1]?.style.display).toBe('block')
		buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		expect(reload).toHaveBeenCalledTimes(1)
		dispose()
		reload.mockRestore()
	})

	test('protocol failures expose the server-version hint', () => {
		const term = mockConnectionTerminal()
		const dispose = setupReconnect(term, { enabled: true })
		term.setStatus({
			state: 'reconnecting',
			consecutivePreSyncFailures: 3,
			lastFailureReason: 'protocol-error',
		})
		expect(getOverlay()?.querySelector('div')?.textContent).toBe(
			'Connection failed — refresh, and check the server version.',
		)
		dispose()
	})

	test('connection notice replaces the state message without a second overlay', () => {
		const term = mockConnectionTerminal({
			state: 'syncing',
			consecutivePreSyncFailures: 0,
			lastFailureReason: null,
		})
		const dispose = setupReconnect(term, { enabled: true })
		window.dispatchEvent(
			new CustomEvent('remobi-connection-notice', { detail: 'Not sent — still syncing.' }),
		)
		expect(document.querySelectorAll('#remobi-reconnect-overlay')).toHaveLength(1)
		expect(getOverlay()?.querySelector('div')?.textContent).toBe('Not sent — still syncing.')
		dispose()
	})
})
