import { createDefaultActionRegistry } from './actions/registry'
import { defaultConfig } from './config'
import { createComboPicker } from './controls/combo-picker'
import { createFloatingButtons } from './controls/floating-buttons'
import { createHelpOverlay } from './controls/help'
import type { KeyboardController } from './controls/keyboard-controller'
import {
	createKeyboardController,
	reportKeyboardUnavailable,
	syncKeyboardIndicators,
	withKeyboardEscapeHatch,
} from './controls/keyboard-controller'
import { createScrollButtons } from './controls/scroll-buttons'
import { createDrawer } from './drawer/drawer'
import { attachDoubleTapGesture } from './gestures/double-tap'
import { createGestureLock } from './gestures/lock'
import { attachPinchGestures } from './gestures/pinch'
import { attachScrollGesture } from './gestures/scroll'
import { attachSwipeGestures } from './gestures/swipe'
import { createHookRegistry } from './hooks/registry'
import type { HookRegistry } from './hooks/registry'
import { setupReconnect } from './reconnect'
import { createStartupResizeScheduler } from './startup-resize'
import { applyTheme } from './theme/apply'
import { createToolbar } from './toolbar/toolbar'
import type { RemobiConfig, XTerminal } from './types'
import { resizeTerm, sendData, waitForTerm } from './util/terminal'
import { initHeightManager } from './viewport/height'

// Re-export for package consumers
export { defineConfig } from './config'
export { createHookRegistry }
export type {
	RemobiConfig,
	RemobiConfigOverrides,
	ButtonAction,
	ButtonArrayInput,
	ControlButton,
	KeyboardMode,
	TermTheme,
	FloatingButtonGroup,
	FloatingPosition,
	FloatingDirection,
	ReconnectConfig,
} from './types'
export type { HookRegistry, SendSource } from './hooks/registry'

/**
 * Read the persisted font size (localStorage `remobi:fontSize`).
 * Returns undefined when absent or unreadable (iOS private mode throws).
 */
function readPersistedFontSize(): number | undefined {
	try {
		const raw = localStorage.getItem('remobi:fontSize')
		if (raw === null) return undefined
		const size = Number(raw)
		return Number.isFinite(size) ? size : undefined
	} catch (error) {
		console.error('remobi: failed to read persisted font size', error)
		return undefined
	}
}

/** Apply theme and font — a persisted font size (user-adjusted via the
 *  drawer's Font -/+ buttons) wins over the config default */
function applyTermAppearance(term: XTerminal, config: RemobiConfig): void {
	applyTheme(term, config.theme)
	term.options.fontSize = readPersistedFontSize() ?? config.font.mobileSizeDefault
	term.options.fontFamily = config.font.family
}

/** Detect touch device */
function isMobile(): boolean {
	return 'ontouchstart' in window || navigator.maxTouchPoints > 0
}

/**
 * Initialise the help overlay and return its opener.
 * Fail-safe: a help failure must never break the core controls.
 */
function setupHelpOverlay(
	term: XTerminal,
	config: RemobiConfig,
	version?: string,
): (() => void) | undefined {
	try {
		const helpOverlay = createHelpOverlay(term, config, version)
		document.body.appendChild(helpOverlay.element)
		return helpOverlay.open
	} catch (error) {
		console.error('remobi: failed to initialise help overlay', error)
		return undefined
	}
}

/**
 * Keyboard sovereignty setup: escape hatch (V2) + shared controller (T-B).
 * Returns the effective config — with the default ⌨ button injected into
 * toolbar row1 when manual mode has no keyboard-toggle anywhere.
 */
function setupKeyboard(
	term: XTerminal,
	config: RemobiConfig,
): { readonly effectiveConfig: RemobiConfig; readonly keyboard: KeyboardController } {
	const effectiveConfig = withKeyboardEscapeHatch(config)
	const keyboard = createKeyboardController(term, effectiveConfig.mobile.keyboardMode)
	return { effectiveConfig, keyboard }
}

/**
 * Initialise the remobi overlay.
 * Called automatically when loaded in a browser (via the IIFE in build output).
 * Config is embedded at build time.
 */
export function init(
	config: RemobiConfig = defaultConfig,
	hooks: HookRegistry = createHookRegistry(),
	version?: string,
): void {
	void waitForTerm()
		.then(async (term) => {
			// Reconnect overlay — works on both mobile and desktop
			const disposeReconnect = setupReconnect(term, config.reconnect)
			const startupResize = createStartupResizeScheduler({
				resize: resizeTerm,
				fontsReady: document.fonts.ready,
			})

			const mobile = isMobile()
			let disposed = false
			let keyboard: KeyboardController | undefined
			const disposeOverlayReadyResize = hooks.on('overlayReady', () => {
				startupResize.scheduleAfterLayout()
			})

			function dispose(): void {
				if (disposed) return
				disposed = true
				keyboard?.dispose()
				disposeOverlayReadyResize.dispose()
				startupResize.dispose()
				disposeReconnect()
				window.removeEventListener('pagehide', onPageHide)
			}

			function onPageHide(event: PageTransitionEvent): void {
				if (event.persisted) return
				dispose()
			}

			window.addEventListener('beforeunload', dispose, { once: true })
			window.addEventListener('pagehide', onPageHide)

			try {
				await hooks.runOverlayInitStart({ term, config, mobile })

				document.title = `${config.name} · ${location.hostname.replace(/\..*/, '')}`

				if (!mobile) {
					await hooks.runOverlayReady({ term, config, mobile })
					return
				}

				// Apply theme and font (persisted font size wins over config)
				applyTermAppearance(term, config)
				startupResize.scheduleImmediate()

				// CSS is injected as a <style> tag by the build script (build.ts)

				const comboPicker = createComboPicker()
				document.body.appendChild(comboPicker.element)

				// Help overlay first — the drawer's Guide button opens it via the
				// action registry.
				const openHelp = setupHelpOverlay(term, config, version)

				// Keyboard sovereignty: escape hatch (V2) injects a ⌨ button into
				// row1 when manual mode lacks one; the controller must exist before
				// the action registry so keyboard-toggle can be wired via DI.
				const setup = setupKeyboard(term, config)
				keyboard = setup.keyboard
				const effectiveConfig = setup.effectiveConfig
				const keyboardController = setup.keyboard

				const actions = createDefaultActionRegistry({
					font: config.font,
					openHelp,
					toggleKeyboard: () => keyboardController.toggle(),
				})

				// Create drawer (needed by toolbar for toggle)
				const drawer = createDrawer(term, effectiveConfig.drawer.buttons, {
					hooks,
					appConfig: effectiveConfig,
					actions,
					openComboPicker: comboPicker.open,
				})
				document.body.appendChild(drawer.backdrop)
				document.body.appendChild(drawer.drawer)
				await hooks.runDrawerCreated({
					term,
					config: effectiveConfig,
					drawer: drawer.drawer,
					backdrop: drawer.backdrop,
				})

				// Create toolbar
				const { element: toolbar } = createToolbar(
					term,
					effectiveConfig,
					drawer.open,
					hooks,
					actions,
					comboPicker.open,
				)
				document.body.appendChild(toolbar)
				await hooks.runToolbarCreated({ term, config: effectiveConfig, toolbar })

				// Floating button groups (always visible on touch devices)
				if (effectiveConfig.floatingButtons.length > 0) {
					const { elements: floatingEls } = createFloatingButtons(
						term,
						effectiveConfig.floatingButtons,
						effectiveConfig,
						hooks,
						actions,
						drawer.open,
						comboPicker.open,
					)
					for (const floatingEl of floatingEls) {
						document.body.appendChild(floatingEl)
					}
				}

				// Keyboard indicator (V1) — document-level so drawer and floating
				// ⌨ buttons reflect the state too, not just the toolbar's.
				syncKeyboardIndicators(keyboardController, document)
				keyboardController.subscribe(() => syncKeyboardIndicators(keyboardController, document))

				// Fail loud (T-E#6) when the keyboard mechanism is unavailable.
				reportKeyboardUnavailable(keyboardController)

				// Scroll buttons (opt-in — finger-drag scroll covers this by default)
				if (config.scrollButtons.enabled) {
					const { element: scrollButtons } = createScrollButtons(term, config.gestures.scroll)
					document.body.appendChild(scrollButtons)
				}

				// Gestures
				const gestureLock = createGestureLock()
				if (config.gestures.swipe.enabled) {
					const indicator = attachSwipeGestures(term, config.gestures.swipe, drawer.isOpen)
					document.body.appendChild(indicator)
				}
				if (config.gestures.pinch.enabled) {
					attachPinchGestures(term, config.font, gestureLock)
				}
				if (config.gestures.scroll.enabled) {
					attachScrollGesture(term, config.gestures.scroll, gestureLock, drawer.isOpen)
				}
				if (config.gestures.doubleTap.enabled) {
					attachDoubleTapGesture(term, config.gestures.doubleTap, drawer.isOpen)
				}

				// Height management
				initHeightManager(toolbar)

				// Mobile init data: send once on load if viewport is narrow enough.
				// Already inside isMobile() guard (touch detection). widthThreshold adds a
				// second filter — a wide-viewport touch device (e.g. landscape tablet) may
				// not want mobile init behaviour.
				if (config.mobile.initData !== null && window.innerWidth < config.mobile.widthThreshold) {
					const data = config.mobile.initData
					const before = await hooks.runBeforeSendData({
						term,
						config,
						source: 'mobile-init',
						actionType: 'send',
						kbWasOpen: false,
						data,
					})
					if (!before.blocked) {
						sendData(term, before.data)
						await hooks.runAfterSendData({
							term,
							config,
							source: 'mobile-init',
							actionType: 'send',
							kbWasOpen: false,
							data: before.data,
						})
					}
				}

				await hooks.runOverlayReady({ term, config, mobile })
			} catch (error) {
				dispose()
				throw error
			}
		})
		.catch((error) => {
			console.error('remobi: failed to initialise overlay', error)
		})
}
