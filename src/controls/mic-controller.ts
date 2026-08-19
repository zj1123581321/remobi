import { DoubaoEngine } from '../asr/doubao/engine'
import type { AsrEngine, AsrErrorCode } from '../asr/types'
import type { HookRegistry } from '../hooks/registry'
import { createAsrPreview, type AsrPreview } from './asr-preview'
import type { RemobiConfig, XTerminal } from '../types'
import { sendData } from '../util/terminal'
import { haptic } from '../util/haptic'

export type MicState =
	| 'idle'
	| 'permission-requesting'
	| 'connecting'
	| 'recording'
	| 'stopping'
	| 'waiting-final'
	| 'preview'
	| 'error'
	| 'cancelled'

export interface MicController {
	readonly preview: AsrPreview
	readonly state: MicState
	attach(button: HTMLButtonElement): void
	dispose(): void
}

interface MicControllerOptions {
	readonly term: XTerminal
	readonly config: RemobiConfig
	readonly hooks: HookRegistry
	readonly engine?: AsrEngine
}

const HOLD_THRESHOLD_MS = 300
const CONNECT_TIMEOUT_MS = 5_000
const WAITING_FINAL_TIMEOUT_MS = 3_000

const ERROR_MESSAGES: Record<AsrErrorCode, string> = {
	unsupported: 'Voice input is not supported in this browser.',
	'permission-denied': 'Microphone permission was denied.',
	'audio-context': 'The audio capture context failed.',
	'audio-interrupted': 'Audio input was interrupted.',
	'unsupported-sample-rate': 'The microphone sample rate is unsupported.',
	'worklet-load-failed': 'The audio capture module failed to load.',
	'connection-failed': 'Voice service connection failed. Check the key and network.',
	'socket-closed': 'Voice service connection closed before the final result.',
	'protocol-error': 'Voice service returned an invalid response.',
	'provider-error': 'Voice service rejected the request.',
	'network-too-slow': 'Voice service is too slow to keep up with the microphone.',
}

/** Browser capability gate used before rendering a voice-input toolbar button. */
export function isVoiceInputSupported(): boolean {
	return (
		globalThis.isSecureContext === true &&
		Boolean(globalThis.navigator?.mediaDevices?.getUserMedia)
	)
}

/** Keep only terminal-safe printable text and U+0020 space; strip C0, DEL, and C1 controls. */
export function sanitizeVoiceText(text: string): string {
	let result = ''
	for (const character of text) {
		const codePoint = character.codePointAt(0) ?? 0
		if (codePoint >= 0x20 && codePoint !== 0x7f && !(codePoint >= 0x80 && codePoint <= 0x9f)) {
			result += character
		}
	}
	return result
}

function pointerId(event: PointerEvent): number {
	return typeof event.pointerId === 'number' ? event.pointerId : 0
}

function errorMessage(code: AsrErrorCode): string {
	return ERROR_MESSAGES[code]
}

/** PTT controller: the only writer of the UI state is transition(). */
export function createMicController(options: MicControllerOptions): MicController | undefined {
	if (!options.config.asr.enabled) return undefined
	if (!options.engine && !isVoiceInputSupported()) return undefined

	const engine =
		options.engine ??
		new DoubaoEngine({
			apiKey: options.config.asr.doubao.apiKey,
			resourceId: options.config.asr.doubao.resourceId,
		})
	if (!engine.isSupported()) return undefined

	const preview = createAsrPreview()
	document.body.appendChild(preview.element)
	const buttons = new Set<HTMLButtonElement>()
	const buttonDisposers = new Map<HTMLButtonElement, () => void>()
	let currentState: MicState = 'idle'
	let generation = 0
	let activePointer: { readonly button: HTMLButtonElement; readonly id: number } | undefined
	let holdTimer: ReturnType<typeof setTimeout> | undefined
	let connectTimer: ReturnType<typeof setTimeout> | undefined
	let finalTimer: ReturnType<typeof setTimeout> | undefined
	let engineUnsubscribers: Array<() => void> = []
	let appliedSeq = Number.NEGATIVE_INFINITY
	let disposed = false

	function transition(from: readonly MicState[], to: MicState, event: string): void {
		if (!from.includes(currentState)) {
			throw new Error(`Invalid mic transition ${currentState} -> ${to} (${event})`)
		}
		currentState = to
		for (const button of buttons) {
			button.dataset.micState = to
			button.setAttribute('aria-pressed', to === 'recording' ? 'true' : 'false')
			button.classList.toggle('wt-mic-recording', to === 'recording')
		}
	}

	function clearTimers(): void {
		if (holdTimer !== undefined) clearTimeout(holdTimer)
		if (connectTimer !== undefined) clearTimeout(connectTimer)
		if (finalTimer !== undefined) clearTimeout(finalTimer)
		holdTimer = undefined
		connectTimer = undefined
		finalTimer = undefined
	}

	function releasePointer(): void {
		const pointer = activePointer
		activePointer = undefined
		if (pointer && typeof pointer.button.releasePointerCapture === 'function') {
			if (pointer.button.hasPointerCapture(pointer.id)) pointer.button.releasePointerCapture(pointer.id)
		}
	}

	function clearEngineHandlers(): void {
		for (const unsubscribe of engineUnsubscribers) unsubscribe()
		engineUnsubscribers = []
	}

	function cleanupSession(): void {
		clearTimers()
		clearEngineHandlers()
		releasePointer()
	}

	function stopEngine(): void {
		void engine.stop().catch((error: unknown) => {
			console.error('remobi: ASR stop failed', error)
		})
	}

	function endAsIdle(): void {
		generation++
		cleanupSession()
		if (currentState !== 'idle') {
			transition(
				['preview', 'error', 'cancelled', 'permission-requesting', 'connecting'],
				'idle',
				'end',
			)
		}
	}

	function showError(code: AsrErrorCode, sessionGeneration: number): void {
		if (disposed || sessionGeneration !== generation || currentState === 'idle') return
		clearTimers()
		const hadText = preview.getText().length > 0
		transition(
			['permission-requesting', 'connecting', 'recording', 'stopping', 'waiting-final'],
			'error',
			`error:${code}`,
		)
		preview.showMessage(errorMessage(code))
		stopEngine()
		generation++
		cleanupSession()
		if (hadText) transition(['error'], 'preview', 'error-preview')
		else transition(['error'], 'idle', 'error-idle')
	}

	function cancelSession(message: string, sessionGeneration: number): void {
		if (disposed || sessionGeneration !== generation || currentState === 'idle') return
		clearTimers()
		transition(
			['permission-requesting', 'connecting', 'recording', 'stopping', 'waiting-final'],
			'cancelled',
			'cancel',
		)
		preview.clear()
		preview.showMessage(message)
		stopEngine()
		generation++
		cleanupSession()
		transition(['cancelled'], 'idle', 'cancelled-idle')
	}

	function finishPreview(sessionGeneration: number): void {
		if (disposed || sessionGeneration !== generation || currentState !== 'waiting-final') return
		if (finalTimer !== undefined) clearTimeout(finalTimer)
		finalTimer = undefined
		transition(['waiting-final'], 'preview', 'final-timeout')
		preview.showMessage('Ready to send. Edit the text or cancel.')
	}

	function onFinal(text: string, sequence: number | undefined, sessionGeneration: number): void {
		if (
			disposed ||
			sessionGeneration !== generation ||
			(currentState !== 'waiting-final' && currentState !== 'preview')
		)
			return
		if (sequence !== undefined) {
			if (sequence <= appliedSeq) return
			appliedSeq = sequence
		}
		preview.show(text)
		if (currentState === 'waiting-final') finishPreview(sessionGeneration)
	}

	function stopRecording(sessionGeneration: number): void {
		if (sessionGeneration !== generation || currentState !== 'recording') return
		if (connectTimer !== undefined) clearTimeout(connectTimer)
		connectTimer = undefined
		transition(['recording'], 'stopping', 'pointerup')
		transition(['stopping'], 'waiting-final', 'stop-requested')
		finalTimer = setTimeout(() => finishPreview(sessionGeneration), WAITING_FINAL_TIMEOUT_MS)
		void engine.stop().catch((error: unknown) => {
			console.error('remobi: ASR stop failed', error)
			if (currentState === 'waiting-final') showError('socket-closed', sessionGeneration)
		})
	}

	function bindEngine(sessionGeneration: number): void {
		engineUnsubscribers = [
			engine.onPartial((text) => {
				if (disposed || sessionGeneration !== generation || currentState !== 'recording') return
				preview.setPartial(text)
			}),
			engine.onFinal((text, sequence) => onFinal(text, sequence, sessionGeneration)),
			engine.onError((code) => {
				if (code === 'audio-interrupted') {
					cancelSession('Audio input was interrupted; recording cancelled.', sessionGeneration)
					return
				}
				showError(code, sessionGeneration)
			}),
		]
	}

	async function startEngine(sessionGeneration: number): Promise<void> {
		try {
			await engine.start()
		} catch (error: unknown) {
			const code: AsrErrorCode = error instanceof Error && error.name === 'NotAllowedError'
				? 'permission-denied'
				: 'connection-failed'
			showError(code, sessionGeneration)
			return
		}
		if (disposed || sessionGeneration !== generation || currentState !== 'connecting') return
		if (connectTimer !== undefined) clearTimeout(connectTimer)
		connectTimer = undefined
		transition(['connecting'], 'recording', 'engine-started')
	}

	function beginConnecting(sessionGeneration: number): void {
		if (disposed || sessionGeneration !== generation || currentState !== 'permission-requesting') return
		transition(['permission-requesting'], 'connecting', 'hold-threshold')
		connectTimer = setTimeout(() => showError('connection-failed', sessionGeneration), CONNECT_TIMEOUT_MS)
		bindEngine(sessionGeneration)
		void startEngine(sessionGeneration)
	}

	function pointerDown(button: HTMLButtonElement, event: PointerEvent): void {
		if (disposed || currentState !== 'idle') return
		event.preventDefault()
		const id = pointerId(event)
		activePointer = { button, id }
		if (typeof button.setPointerCapture === 'function') button.setPointerCapture(id)
		generation++
		const sessionGeneration = generation
		appliedSeq = Number.NEGATIVE_INFINITY
		preview.clear()
		transition(['idle'], 'permission-requesting', 'pointerdown')
		haptic()
		holdTimer = setTimeout(() => beginConnecting(sessionGeneration), HOLD_THRESHOLD_MS)
	}

	function pointerUp(event: PointerEvent): void {
		if (!activePointer || pointerId(event) !== activePointer.id) return
		event.preventDefault()
		const sessionGeneration = generation
		releasePointer()
		if (currentState === 'recording') {
			stopRecording(sessionGeneration)
			return
		}
		if (currentState === 'permission-requesting' || currentState === 'connecting') {
			cancelSession('Hold the microphone button for at least 300 ms.', sessionGeneration)
		}
	}

	function pointerCancel(event: PointerEvent): void {
		if (!activePointer || pointerId(event) !== activePointer.id) return
		event.preventDefault()
		cancelSession('Recording cancelled.', generation)
	}

	function confirmPreview(): void {
		if (disposed || currentState !== 'preview') return
		const sessionGeneration = generation
		const rawText = preview.getText()
		if (!rawText) {
			preview.showMessage('No speech was recognized.')
			return
		}
		if (!options.term.isConnected()) {
			preview.showMessage('Terminal disconnected; text is kept here until it reconnects.')
			return
		}
		void (async () => {
			const before = await options.hooks.runBeforeSendData({
				term: options.term,
				config: options.config,
				source: 'toolbar',
				actionType: 'voice-input',
				kbWasOpen: false,
				data: rawText,
			})
			if (disposed || sessionGeneration !== generation || currentState !== 'preview') return
			if (before.blocked) return
			const text = sanitizeVoiceText(before.data)
			if (!text) {
				preview.showMessage('Speech contained no printable text.')
				return
			}
			if (!options.term.isConnected()) {
				preview.showMessage('Terminal disconnected; text is kept here until it reconnects.')
				return
			}
			sendData(options.term, text)
			await options.hooks.runAfterSendData({
				term: options.term,
				config: options.config,
				source: 'toolbar',
				actionType: 'voice-input',
				kbWasOpen: false,
				data: text,
			})
			if (disposed || sessionGeneration !== generation || currentState !== 'preview') return
			if (options.config.asr.autoEnter) sendData(options.term, '\r')
			preview.clear()
			endAsIdle()
		})()
	}

	function cancelPreview(): void {
		if (currentState !== 'preview' && currentState !== 'error') return
		preview.clear()
		stopEngine()
		endAsIdle()
	}

	function onVisibilityChange(): void {
		if (document.visibilityState === 'hidden' && currentState !== 'idle') {
			cancelSession('App went into the background; recording cancelled.', generation)
		}
	}

	const previewConfirm = preview.onConfirm(confirmPreview)
	const previewCancel = preview.onCancel(cancelPreview)
	document.addEventListener('visibilitychange', onVisibilityChange)
	const connection = options.term.onConnectionChange((connected) => {
		if (!connected && currentState === 'preview' && preview.getText()) {
			preview.showMessage('Terminal disconnected; text is kept here until it reconnects.')
		}
	})

	const controller: MicController = {
		preview,
		get state() {
			return currentState
		},
		attach(button) {
			if (buttonDisposers.has(button)) return
			const down = (event: Event): void => pointerDown(button, event as PointerEvent)
			const up = (event: Event): void => pointerUp(event as PointerEvent)
			const cancel = (event: Event): void => pointerCancel(event as PointerEvent)
			button.addEventListener('pointerdown', down)
			button.addEventListener('pointerup', up)
			button.addEventListener('pointercancel', cancel)
			button.setAttribute('aria-label', 'Hold to speak')
			button.setAttribute('aria-pressed', 'false')
			buttons.add(button)
			buttonDisposers.set(button, () => {
				button.removeEventListener('pointerdown', down)
				button.removeEventListener('pointerup', up)
				button.removeEventListener('pointercancel', cancel)
			})
		},
		dispose() {
			if (disposed) return
			disposed = true
			generation++
			clearTimers()
			stopEngine()
			for (const disposeButton of buttonDisposers.values()) disposeButton()
			buttonDisposers.clear()
			buttons.clear()
			clearEngineHandlers()
			previewConfirm.dispose()
			previewCancel.dispose()
			connection.dispose()
			document.removeEventListener('visibilitychange', onVisibilityChange)
			preview.element.remove()
		},
	}

	return controller
}
