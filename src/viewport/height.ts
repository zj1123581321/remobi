import type { AsrPreview } from '../controls/asr-preview'
import { isKeyboardOpen } from '../util/keyboard'
import { resizeTerm } from '../util/terminal'
import { checkLandscapeKeyboard } from './landscape'

export function viewportHeight(
	vp: Pick<VisualViewport, 'height' | 'offsetTop'> | null,
	fallbackHeight: number,
	includeOffsetTop: boolean,
): number {
	if (!vp) return fallbackHeight
	return includeOffsetTop ? vp.height + vp.offsetTop : vp.height
}

export function lockDocumentHeight(height: string): void {
	document.documentElement.style.setProperty('height', height, 'important')
	document.documentElement.style.setProperty('max-height', height, 'important')
	document.documentElement.style.setProperty('overflow', 'hidden', 'important')
	document.documentElement.style.setProperty('overscroll-behavior', 'none', 'important')

	document.body.style.setProperty('min-height', '0', 'important')
	document.body.style.setProperty('height', height, 'important')
	document.body.style.setProperty('max-height', height, 'important')
	document.body.style.setProperty('overflow', 'hidden', 'important')
	document.body.style.setProperty('overscroll-behavior', 'none', 'important')
}

export function bottomChromeHeight(
	keyboardOpen: boolean,
	composerOpen: boolean,
	toolbarHeight: number,
	composerHeight: number,
): number {
	if (keyboardOpen) return 0
	return composerOpen ? composerHeight : toolbarHeight
}

/**
 * Manage terminal height to account for the toolbar and virtual keyboard.
 * Uses visualViewport API when available for accurate keyboard detection.
 */
export function initHeightManager(
	toolbar: HTMLDivElement,
	composer?: Pick<AsrPreview, 'element' | 'isOpen'>,
): () => void {
	let pendingResize = 0

	function updateHeight(): void {
		pendingResize = 0
		checkLandscapeKeyboard(toolbar)

		const vp = window.visualViewport
		const kbOpen = isKeyboardOpen()
		const vh = viewportHeight(vp, window.innerHeight, kbOpen)
		const chromeH = bottomChromeHeight(
			kbOpen,
			composer?.isOpen() ?? false,
			toolbar.offsetHeight || 90,
			composer?.element.offsetHeight ?? 0,
		)
		const h = `${vh - chromeH}px`

		lockDocumentHeight(h)
		resizeTerm()
	}

	function scheduleResize(): void {
		if (!pendingResize) {
			pendingResize = requestAnimationFrame(updateHeight)
		}
	}

	if (window.visualViewport) {
		window.visualViewport.addEventListener('resize', scheduleResize)
		window.visualViewport.addEventListener('scroll', scheduleResize)
	}
	window.addEventListener('resize', scheduleResize)
	window.addEventListener('orientationchange', () => {
		setTimeout(scheduleResize, 200)
	})

	scheduleResize()
	return scheduleResize
}
