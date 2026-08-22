import { isKeyboardOpen } from '../util/keyboard'

/**
 * Detect landscape orientation + keyboard open state.
 * In landscape with keyboard, hides row 2 and shrinks buttons via CSS class.
 * Reads only viewport globals and writes the class — never touches layout,
 * so callers can safely invoke it between layout reads and DOM writes.
 */
export function checkLandscapeKeyboard(toolbar: HTMLDivElement): void {
	if (!window.visualViewport) return

	if (isKeyboardOpen() && window.innerWidth > window.innerHeight) {
		toolbar.classList.add('wt-kb-open')
	} else {
		toolbar.classList.remove('wt-kb-open')
	}
}
