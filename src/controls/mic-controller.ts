import { DoubaoEngine } from '../asr/doubao/engine'
import type { AsrEngine, AsrErrorCode } from '../asr/types'
import type { HookRegistry } from '../hooks/registry'
import type { RemobiConfig, XTerminal } from '../types'
import { haptic } from '../util/haptic'
import { conditionalFocus, isKeyboardOpen } from '../util/keyboard'
import { onTap } from '../util/tap'
import { sendData } from '../util/terminal'
import { type AsrPreview, createAsrPreview } from './asr-preview'
import { suppressSynthesisedMouse } from './keyboard-controller'

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
	attachComposerToggle(button: HTMLButtonElement): void
	attachMicButton(button: HTMLButtonElement): void
	dispose(): void
}

interface MicControllerOptions {
	readonly term: XTerminal
	readonly config: RemobiConfig
	readonly hooks: HookRegistry
	readonly engine?: AsrEngine
	readonly closeComposerOverlays?: () => void
}

const CONNECT_TIMEOUT_MS = 5_000
const WAITING_FINAL_TIMEOUT_MS = 3_000
const NON_PRINTING_FORMAT_OR_SEPARATOR = /[\p{Cf}\p{Zl}\p{Zp}]/u

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
		globalThis.isSecureContext === true && Boolean(globalThis.navigator?.mediaDevices?.getUserMedia)
	)
}

/** Keep terminal-safe printable text and U+0020 space; strip controls and format separators. */
export function sanitizeVoiceText(text: string): string {
	let result = ''
	for (const character of text) {
		const codePoint = character.codePointAt(0) ?? 0
		if (codePoint < 0x20 || codePoint === 0x7f || (codePoint >= 0x80 && codePoint <= 0x9f)) continue
		if (NON_PRINTING_FORMAT_OR_SEPARATOR.test(character)) continue
		result += character
	}
	return result
}

function errorMessage(code: AsrErrorCode): string {
	return ERROR_MESSAGES[code]
}

/** Tap-to-toggle controller: the only writer of the UI state is transition(). */
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
	const micButtons = new Set<HTMLButtonElement>()
	const composerButtons = new Set<HTMLButtonElement>()
	const buttonDisposers = new Map<HTMLButtonElement, () => void>()
	let currentState: MicState = 'idle'
	let generation = 0
	let connectTimer: ReturnType<typeof setTimeout> | undefined
	let finalTimer: ReturnType<typeof setTimeout> | undefined
	let engineUnsubscribers: Array<() => void> = []
	let appliedSeq = Number.NEGATIVE_INFINITY
	let pendingAction: 'send' | undefined
	let disposed = false

	function transition(from: readonly MicState[], to: MicState, event: string): void {
		if (!from.includes(currentState)) {
			throw new Error(`Invalid mic transition ${currentState} -> ${to} (${event})`)
		}
		currentState = to
		preview.input.readOnly = to !== 'idle' && to !== 'preview' && to !== 'error'
		for (const button of micButtons) {
			button.dataset.micState = to
			button.setAttribute('aria-pressed', to === 'recording' ? 'true' : 'false')
			button.classList.toggle('wt-mic-recording', to === 'recording')
		}
	}

	function setComposerExpanded(expanded: boolean): void {
		for (const button of composerButtons) {
			button.setAttribute('aria-expanded', expanded ? 'true' : 'false')
		}
	}

	function clearTimers(): void {
		if (connectTimer !== undefined) clearTimeout(connectTimer)
		if (finalTimer !== undefined) clearTimeout(finalTimer)
		connectTimer = undefined
		finalTimer = undefined
	}

	function clearEngineHandlers(): void {
		for (const unsubscribe of engineUnsubscribers) unsubscribe()
		engineUnsubscribers = []
	}

	function cleanupSession(): void {
		clearTimers()
		clearEngineHandlers()
	}

	function stopEngine(): void {
		void engine.stop().catch((error: unknown) => {
			console.error('remobi: ASR stop failed', error)
		})
	}

	function endAsIdle(): void {
		generation++
		cleanupSession()
		preview.close()
		setComposerExpanded(false)
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
	}

	function cancelSession(sessionGeneration: number): void {
		if (disposed || sessionGeneration !== generation || currentState === 'idle') return
		pendingAction = undefined
		clearTimers()
		transition(
			[
				'permission-requesting',
				'connecting',
				'recording',
				'stopping',
				'waiting-final',
				'preview',
				'error',
			],
			'cancelled',
			'cancel',
		)
		preview.clear()
		stopEngine()
		generation++
		cleanupSession()
		transition(['cancelled'], 'idle', 'cancelled-idle')
		setComposerExpanded(false)
	}

	function finishPreview(sessionGeneration: number): void {
		if (disposed || sessionGeneration !== generation || currentState !== 'waiting-final') return
		const shouldSend = pendingAction === 'send'
		pendingAction = undefined
		generation++
		cleanupSession()
		transition(['waiting-final'], 'preview', 'final-timeout')
		preview.showMessage('Ready to send. Edit the text or cancel.')
		if (shouldSend) confirmPreview()
	}

	function onFinal(text: string, sequence: number | undefined, sessionGeneration: number): void {
		if (disposed || sessionGeneration !== generation || currentState !== 'waiting-final') return
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
		transition(['recording'], 'stopping', 'tap')
		transition(['stopping'], 'waiting-final', 'stop-requested')
		preview.showMessage('Finishing…')
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
					showError(code, sessionGeneration)
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
			const code: AsrErrorCode =
				error instanceof Error && error.name === 'NotAllowedError'
					? 'permission-denied'
					: 'connection-failed'
			showError(code, sessionGeneration)
			return
		}
		if (disposed || sessionGeneration !== generation || currentState !== 'connecting') return
		if (connectTimer !== undefined) clearTimeout(connectTimer)
		connectTimer = undefined
		transition(['connecting'], 'recording', 'engine-started')
		preview.showMessage('Listening…')
	}

	function beginConnecting(sessionGeneration: number): void {
		if (disposed || sessionGeneration !== generation || currentState !== 'permission-requesting')
			return
		transition(['permission-requesting'], 'connecting', 'tap-start')
		preview.showMessage('Connecting to voice service…')
		connectTimer = setTimeout(
			() => showError('connection-failed', sessionGeneration),
			CONNECT_TIMEOUT_MS,
		)
		bindEngine(sessionGeneration)
		void startEngine(sessionGeneration)
	}

	function startSession(): void {
		if (disposed || currentState !== 'idle') return
		generation++
		const sessionGeneration = generation
		pendingAction = undefined
		appliedSeq = Number.NEGATIVE_INFINITY
		preview.clear()
		transition(['idle'], 'permission-requesting', 'tap-start')
		preview.showMessage('Requesting microphone…')
		haptic()
		beginConnecting(sessionGeneration)
	}

	function openComposer(): void {
		if (disposed || currentState !== 'idle') return
		options.closeComposerOverlays?.()
		preview.open()
		setComposerExpanded(true)
		haptic()
	}

	function canSendComposerText(sessionGeneration: number, wasOpen: boolean): boolean {
		return (
			!disposed &&
			sessionGeneration === generation &&
			wasOpen &&
			(currentState === 'preview' || currentState === 'idle')
		)
	}

	function tapToggle(): void {
		if (disposed) return
		const kbWasOpen = isKeyboardOpen()
		const sessionGeneration = generation
		let toggled = false
		if (currentState === 'idle') {
			toggled = true
			startSession()
		} else if (currentState === 'recording') {
			toggled = true
			stopRecording(sessionGeneration)
		} else if (currentState === 'permission-requesting' || currentState === 'connecting') {
			toggled = true
			cancelSession(sessionGeneration)
		} else if (currentState === 'error') {
			toggled = true
			cancelSession(sessionGeneration)
			startSession()
		}
		if (toggled) conditionalFocus(options.term, kbWasOpen)
	}

	function confirmPreview(): void {
		if (disposed) return
		if (currentState === 'recording') {
			pendingAction = 'send'
			stopRecording(generation)
			return
		}
		if (currentState === 'stopping' || currentState === 'waiting-final') {
			pendingAction = 'send'
			return
		}
		if (currentState !== 'preview' && currentState !== 'idle') return
		const sessionGeneration = generation
		const wasOpen = preview.isOpen()
		const rawText = preview.getText()
		if (!rawText) {
			preview.showMessage('Type or speak something to send.')
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
			if (!canSendComposerText(sessionGeneration, wasOpen)) return
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
			if (!canSendComposerText(sessionGeneration, wasOpen)) return
			if (options.config.asr.autoEnter) {
				if (!options.term.isConnected()) {
					preview.showMessage('Terminal disconnected; text is kept here until it reconnects.')
					return
				}
				sendData(options.term, '\r')
			}
			preview.clear()
			endAsIdle()
		})()
	}

	function cancelPreview(): void {
		if (
			currentState === 'permission-requesting' ||
			currentState === 'connecting' ||
			currentState === 'recording' ||
			currentState === 'stopping' ||
			currentState === 'waiting-final'
		) {
			cancelSession(generation)
			return
		}
		if (currentState !== 'preview' && currentState !== 'error' && currentState !== 'idle') return
		preview.clear()
		stopEngine()
		endAsIdle()
	}

	function onVisibilityChange(): void {
		if (document.visibilityState === 'hidden' && currentState !== 'idle') {
			cancelSession(generation)
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
		attachComposerToggle(button) {
			if (buttonDisposers.has(button)) return
			suppressSynthesisedMouse(button)
			onTap(button, openComposer)
			button.setAttribute('aria-label', 'Voice composer')
			button.setAttribute('aria-haspopup', 'dialog')
			button.setAttribute('aria-expanded', 'false')
			composerButtons.add(button)
			buttonDisposers.set(button, () => {})
		},
		attachMicButton(button) {
			if (buttonDisposers.has(button)) return
			suppressSynthesisedMouse(button)
			onTap(button, tapToggle)
			button.setAttribute('aria-label', 'Toggle microphone')
			button.setAttribute('aria-pressed', 'false')
			button.dataset.micState = 'idle'
			micButtons.add(button)
			buttonDisposers.set(button, () => {})
		},
		dispose() {
			if (disposed) return
			disposed = true
			generation++
			clearTimers()
			stopEngine()
			for (const disposeButton of buttonDisposers.values()) disposeButton()
			buttonDisposers.clear()
			micButtons.clear()
			composerButtons.clear()
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
