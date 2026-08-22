import type { XTerminal } from '../types'

/** Threshold in pixels — if the viewport height drops more than this below the observed ceiling, the keyboard is open */
const KB_THRESHOLD = 150

/**
 * Largest viewport height observed so far — the baseline the soft keyboard
 * shrinks away from. Tracked because interactive-widget=resizes-content
 * shrinks window.innerHeight together with the visual viewport, so a plain
 * `innerHeight - vp.height` diff no longer detects the keyboard there.
 * Reset on orientation change via resetKeyboardHeightBaseline().
 */
let maxObservedViewportHeight = 0

/** Check whether the virtual keyboard appears to be open */
export function isKeyboardOpen(): boolean {
	const vp = window.visualViewport
	if (!vp) return false
	maxObservedViewportHeight = Math.max(maxObservedViewportHeight, vp.height, window.innerHeight)
	return maxObservedViewportHeight - vp.height > KB_THRESHOLD
}

/** Reset the keyboard-detection height baseline (call on orientationchange) */
export function resetKeyboardHeightBaseline(): void {
	maxObservedViewportHeight = 0
}

/** Focus terminal only if the keyboard was already visible */
export function conditionalFocus(term: XTerminal, kbWasOpen: boolean): void {
	if (kbWasOpen) {
		term.focus()
	}
}
