import { createDefaultActionRegistry } from '../actions/registry'
import type { ActionRegistry } from '../actions/registry'
import { decorateKeyboardToggleButton } from '../controls/keyboard-controller'
import type { MicController } from '../controls/mic-controller'
import type { HookRegistry } from '../hooks/registry'
import type { ControlButton, RemobiConfig, XTerminal } from '../types'
import { el, svg } from '../util/dom'
import { haptic } from '../util/haptic'
import { conditionalFocus, isKeyboardOpen } from '../util/keyboard'
import { onTap } from '../util/tap'
import { sendData } from '../util/terminal'

/** Ctrl sticky modifier state */
interface CtrlState {
	active: boolean
	disposer: { dispose(): void } | null
	buttonEl: HTMLButtonElement | null
}

/** Create the ctrl modifier state manager */
function createCtrlState(): CtrlState {
	return { active: false, disposer: null, buttonEl: null }
}

/** Create the inline microphone icon used by the circular voice-input button. */
function createMicIcon(): SVGSVGElement {
	return svg(
		'svg',
		{
			viewBox: '0 0 24 24',
			'aria-hidden': 'true',
			focusable: 'false',
		},
		svg('path', {
			d: 'M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z',
		}),
		svg('path', {
			d: 'M19 11a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V21H8a1 1 0 0 0 0 2h8a1 1 0 0 0 0-2h-3v-3.08A7 7 0 0 0 19 11Z',
		}),
		svg('path', { d: 'M11 21h2v-4h-2v4Z' }),
	)
}

/** Activate ctrl sticky modifier */
function activateCtrl(state: CtrlState, term: XTerminal, theme: RemobiConfig['theme']): void {
	if (!state.buttonEl) return
	state.active = true
	state.buttonEl.style.background = theme.blue
	state.buttonEl.style.color = theme.background

	if (!state.disposer) {
		state.disposer = term.onData((data: string) => {
			if (state.active && data.length === 1) {
				const code = data.charCodeAt(0)
				deactivateCtrl(state, theme)
				if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
					sendData(term, String.fromCharCode(code & 0x1f))
				}
			}
		})
	}
}

/** Deactivate ctrl sticky modifier */
function deactivateCtrl(state: CtrlState, theme: RemobiConfig['theme']): void {
	if (!state.buttonEl) return
	state.active = false
	state.buttonEl.style.background = theme.black
	state.buttonEl.style.color = theme.foreground

	if (state.disposer) {
		state.disposer.dispose()
		state.disposer = null
	}
}

/** Wire up a single button's click handler based on its action type */
function wireButton(
	button: HTMLButtonElement,
	def: ControlButton,
	term: XTerminal,
	ctrlState: CtrlState,
	config: RemobiConfig,
	registry: ActionRegistry,
	hooks: HookRegistry,
	openDrawer: () => void,
	micController: MicController | undefined,
	openComboPicker?: (options: {
		readonly sendText: (data: string) => Promise<void>
		readonly focusIfNeeded: () => void
	}) => void,
): void {
	if (def.action.type === 'voice-input') {
		if (!micController) throw new Error('remobi: voice-input action requires a mic controller')
		micController.attach(button)
		return
	}

	onTap(button, () => {
		const kbWasOpen = isKeyboardOpen()
		haptic()

		async function sendWithCtrlAware(data: string): Promise<void> {
			const before = await hooks.runBeforeSendData({
				term,
				config,
				source: 'toolbar',
				actionType: def.action.type,
				kbWasOpen,
				data,
			})
			if (before.blocked) return

			let nextData = before.data
			if (ctrlState.active && ctrlState.buttonEl) {
				deactivateCtrl(ctrlState, config.theme)
				if (nextData.length === 1) {
					const code = nextData.charCodeAt(0)
					if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
						nextData = String.fromCharCode(code & 0x1f)
					}
				}
			}

			sendData(term, nextData)
			await hooks.runAfterSendData({
				term,
				config,
				source: 'toolbar',
				actionType: def.action.type,
				kbWasOpen,
				data: nextData,
			})
		}

		async function sendRaw(data: string): Promise<void> {
			const before = await hooks.runBeforeSendData({
				term,
				config,
				source: 'toolbar',
				actionType: def.action.type,
				kbWasOpen,
				data,
			})
			if (before.blocked) return

			sendData(term, before.data)
			await hooks.runAfterSendData({
				term,
				config,
				source: 'toolbar',
				actionType: def.action.type,
				kbWasOpen,
				data: before.data,
			})
		}

		void registry
			.execute(def.action, {
				term,
				kbWasOpen,
				focusIfNeeded: () => conditionalFocus(term, kbWasOpen),
				sendText: sendWithCtrlAware,
				sendRawText: sendRaw,
				openDrawer,
				openComboPicker,
				toggleCtrlModifier: () => {
					if (ctrlState.active) {
						deactivateCtrl(ctrlState, config.theme)
					} else {
						activateCtrl(ctrlState, term, config.theme)
					}
					conditionalFocus(term, kbWasOpen)
				},
			})
			.catch((error) => {
				console.error('remobi: toolbar action execution failed', error)
				button.classList.add('wt-action-error')
				conditionalFocus(term, kbWasOpen)
			})
	})
}

/** Build a row of buttons */
function buildRow(
	buttons: readonly ControlButton[],
	term: XTerminal,
	ctrlState: CtrlState,
	config: RemobiConfig,
	registry: ActionRegistry,
	hooks: HookRegistry,
	openDrawer: () => void,
	micController: MicController | undefined,
	openComboPicker?: (options: {
		readonly sendText: (data: string) => Promise<void>
		readonly focusIfNeeded: () => void
	}) => void,
): HTMLDivElement {
	const row = el('div', { class: 'wt-row' })

	for (const def of buttons) {
		if (def.action.type === 'voice-input' && !micController) continue
		const button = el('button')
		button.dataset.remobiAction = def.action.type
		button.dataset.remobiButtonId = def.id
		if (def.action.type === 'voice-input') {
			button.classList.add('wt-mic')
			button.appendChild(createMicIcon())
		} else {
			button.textContent = def.label
		}
		if (def.action.type === 'ctrl-modifier') {
			ctrlState.buttonEl = button
		}
		if (def.action.type === 'keyboard-toggle') {
			decorateKeyboardToggleButton(button)
		}
		wireButton(
			button,
			def,
			term,
			ctrlState,
			config,
			registry,
			hooks,
			openDrawer,
			micController,
			openComboPicker,
		)
		row.appendChild(button)
	}

	return row
}

interface ToolbarResult {
	readonly element: HTMLDivElement
	readonly ctrlState: CtrlState
}

/** Create the toolbar; empty rows are skipped (single-row by default) */
export function createToolbar(
	term: XTerminal,
	config: RemobiConfig,
	openDrawer: () => void,
	hooks: HookRegistry,
	actions: ActionRegistry = createDefaultActionRegistry(),
	openComboPicker?: (options: {
		readonly sendText: (data: string) => Promise<void>
		readonly focusIfNeeded: () => void
	}) => void,
	micController?: MicController,
): ToolbarResult {
	const toolbar = el('div', { id: 'wt-toolbar' })
	const ctrlState = createCtrlState()

	for (const buttons of [config.toolbar.row1, config.toolbar.row2]) {
		if (buttons.length === 0) continue
		toolbar.appendChild(
			buildRow(
				buttons,
				term,
				ctrlState,
				config,
				actions,
				hooks,
				openDrawer,
				micController,
				openComboPicker,
			),
		)
	}

	return { element: toolbar, ctrlState }
}
