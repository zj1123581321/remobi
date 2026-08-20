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
	test.each([
		['disconnected', 'Disconnected'],
		['reconnecting', 'Reconnecting…'],
		['syncing', 'Syncing…'],
		['synced', 'Synced'],
	] as const)('renders the %s state', (state, text) => {
		const term = mockConnectionTerminal()
		const dispose = setupReconnect(term, { enabled: true })
		if (state !== 'disconnected') {
			term.setStatus({ state, consecutivePreSyncFailures: 0, lastFailureReason: null })
		}
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

	test.each(['button', 'backdrop', 'message'] as const)(
		'clicking %s forwards immediate retry once',
		(target) => {
			const term = mockConnectionTerminal()
			const dispose = setupReconnect(term, { enabled: true })
			const overlay = getOverlay()
			const targetElement =
				target === 'button'
					? overlay?.querySelector('button')
					: target === 'message'
						? overlay?.querySelector('div')
						: overlay
			targetElement?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
			expect(term.reconnectCalls).toBe(1)
			dispose()
		},
	)

	test.each([
		['socket-closed', 'Connection failed — you may need to re-authenticate.', 3, true],
		['protocol-error', 'Connection failed — refresh, and check the server version.', 3, false],
		['output-overflow', 'Output too fast — resyncing.', 1, false],
	] as const)('failure hint renders correctly for %s', (reason, message, failures, reloadable) => {
		const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
		const term = mockConnectionTerminal()
		const dispose = setupReconnect(term, { enabled: true })
		term.setStatus({
			state: 'reconnecting',
			consecutivePreSyncFailures: failures,
			lastFailureReason: reason,
		})
		const buttons = [...(getOverlay()?.querySelectorAll('button') ?? [])]
		expect(getOverlay()?.querySelector('div')?.textContent).toBe(message)
		expect(buttons[1]?.style.display).toBe(failures >= 3 ? 'block' : 'none')
		if (reloadable) {
			buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
			expect(reload).toHaveBeenCalledTimes(1)
		}
		dispose()
		reload.mockRestore()
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
