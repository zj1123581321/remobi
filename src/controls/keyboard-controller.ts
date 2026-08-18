import type { ControlButton, KeyboardMode, RemobiConfig, XTerminal } from '../types'
import { el } from '../util/dom'
import { isKeyboardOpen } from '../util/keyboard'

/** Debounce window for rapid keyboard-toggle taps */
export const KEYBOARD_TOGGLE_DEBOUNCE_MS = 300

/** Default keyboard-toggle button (toolbar row2, far right) */
export const keyboardToggleButton: ControlButton = {
	id: 'keyboard-toggle',
	label: '⌨',
	description: 'Toggle the soft keyboard',
	action: { type: 'keyboard-toggle' },
}

/**
 * Shared keyboard state controller (T-E#4 / T-B three-signal model):
 * - `inputPermission` — the single source of truth (manual mode only).
 *   When false in manual mode, the textarea can never receive input.
 * - `textareaFocus` — tracked via term.onFocusChange events.
 * - `keyboardVisible` — viewport heuristic; drives the indicator only and
 *   never participates in transitions. A system-gesture dismiss changes
 *   visibility but NOT permission (the lock was never released).
 *
 * Mode semantics (V1):
 * - auto: ⌨ is momentary control (focus/blur); no permission concept.
 * - manual: ⌨ flips input permission; unlock clears suppression and refocuses
 *   inside the user gesture, lock blurs first then applies suppression.
 */
export interface KeyboardController {
	readonly mode: KeyboardMode
	/** False when the terminal bridge lacks the required mechanism — fail loud */
	readonly available: boolean
	/** manual: current input permission. auto: always true (no permission concept) */
	hasInputPermission(): boolean
	/** Indicator state: auto follows keyboard visibility, manual follows permission */
	indicatorOn(): boolean
	/** User-gesture entry point — call from a tap/click handler. Debounced. */
	toggle(): void
	/** Subscribe to any state change (permission / focus / visibility) */
	subscribe(listener: () => void): { dispose(): void }
	dispose(): void
}

export function createKeyboardController(term: XTerminal, mode: KeyboardMode): KeyboardController {
	// The auto path only needs blur for momentary dismiss; manual needs the
	// suppression mechanism itself.
	const available =
		mode === 'manual'
			? typeof term.setKeyboardSuppressed === 'function'
			: typeof term.blur === 'function'

	let permission = false
	let textareaFocused = false
	let keyboardVisible = isKeyboardOpen()
	let lastToggleAt = 0

	const listeners = new Set<() => void>()

	function notify(): void {
		for (const listener of listeners) {
			listener()
		}
	}

	const focusSub =
		typeof term.onFocusChange === 'function'
			? term.onFocusChange((focused) => {
					textareaFocused = focused
					notify()
				})
			: null

	function onViewportResize(): void {
		const next = isKeyboardOpen()
		if (next !== keyboardVisible) {
			keyboardVisible = next
			notify()
		}
	}
	window.visualViewport?.addEventListener('resize', onViewportResize)

	if (mode === 'manual' && available) {
		// Manual starts locked: suppress before any tap can reach the textarea.
		term.setKeyboardSuppressed?.(true)
	}

	function toggle(): void {
		if (!available) {
			throw new Error(
				`remobi: keyboard-toggle unavailable — terminal bridge lacks ${mode === 'manual' ? 'setKeyboardSuppressed' : 'blur'}`,
			)
		}
		const now = Date.now()
		if (now - lastToggleAt < KEYBOARD_TOGGLE_DEBOUNCE_MS) return
		lastToggleAt = now

		if (mode === 'auto') {
			// Momentary control: dismiss when open/focused, summon otherwise.
			if (keyboardVisible || textareaFocused) {
				term.blur?.()
			} else {
				term.focus()
			}
			return
		}

		permission = !permission
		if (permission) {
			// Unlock: clear suppression first, then refocus inside this gesture.
			term.setKeyboardSuppressed?.(false)
			term.focus()
		} else {
			// Lock: the bridge blurs first, then applies inputmode="none".
			term.setKeyboardSuppressed?.(true)
		}
		notify()
	}

	return {
		mode,
		available,
		hasInputPermission: () => (mode === 'manual' ? permission : true),
		indicatorOn: () => (mode === 'manual' ? permission : keyboardVisible),
		toggle,
		subscribe(listener) {
			listeners.add(listener)
			return {
				dispose() {
					listeners.delete(listener)
				},
			}
		},
		dispose() {
			window.visualViewport?.removeEventListener('resize', onViewportResize)
			focusSub?.dispose()
			listeners.clear()
		},
	}
}

/** All button arrays that may carry a keyboard-toggle button */
function allButtons(config: RemobiConfig): readonly ControlButton[] {
	return [
		...config.toolbar.row1,
		...config.toolbar.row2,
		...config.drawer.buttons,
		...config.floatingButtons.flatMap((group) => group.buttons),
	]
}

/**
 * Escape hatch (V2): in manual mode there must always be a reachable
 * keyboard-toggle, or the user can never summon the keyboard. If the resolved
 * config has none, inject the default button at the end of toolbar row2
 * (the toolbar always renders). Pure — returns a new config.
 */
export function withKeyboardEscapeHatch(config: RemobiConfig): RemobiConfig {
	if (config.mobile.keyboardMode !== 'manual') return config
	if (allButtons(config).some((button) => button.action.type === 'keyboard-toggle')) {
		return config
	}
	return {
		...config,
		toolbar: {
			...config.toolbar,
			row2: [...config.toolbar.row2, keyboardToggleButton],
		},
	}
}

/**
 * Fail-loud (T-E#6) entry point: when the keyboard mechanism is unavailable,
 * mark the buttons and show an overlay instead of silently degrading.
 */
export function reportKeyboardUnavailable(keyboard: KeyboardController): void {
	if (keyboard.available) return
	showKeyboardUnavailableOverlay(keyboard.mode)
}

/**
 * Fail-loud (T-E#6): the suppression mechanism is unavailable — mark every
 * keyboard-toggle button with the error state and show a reconnect-style
 * overlay. Never silently fall back to auto.
 */
export function showKeyboardUnavailableOverlay(mode: KeyboardMode): void {
	const overlay = el('div', {
		id: 'wt-keyboard-unavailable',
		style: [
			'position:fixed',
			'inset:0',
			'z-index:10000',
			'background:rgba(30,30,46,0.92)',
			'color:#cdd6f4',
			'font-family:sans-serif',
			'display:flex',
			'justify-content:center',
			'align-items:center',
			'flex-direction:column',
			'gap:16px',
		].join(';'),
	})
	const message = el('div', {
		style: 'font-size:1.2rem;font-weight:600;text-align:center;padding:0 24px',
	})
	message.textContent = `Keyboard ${mode} mode is unavailable: this terminal does not support soft-keyboard suppression. Remove the ⌨ button or switch mobile.keyboardMode.`
	overlay.appendChild(message)
	document.body.appendChild(overlay)

	for (const button of document.querySelectorAll('.wt-keyboard-toggle')) {
		button.classList.add('wt-action-error')
	}
}
