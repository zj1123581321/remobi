import { el, svg } from '../util/dom'
import { onTap } from '../util/tap'

declare const __remobiBasePath: string | undefined

type ComposerStore = {
	version: 1
	draft: string
	pending: null | {
		id: string
		sessionId: string
		sourceText: string
		data: string
		status: 'pending' | 'unknown' | 'rejected'
		reason?: string
	}
}

type StoredComposer = Omit<ComposerStore, 'pending'> & { pending: unknown }

type StorageReadResult =
	| { readonly kind: 'missing'; readonly storage: Storage }
	| { readonly kind: 'valid'; readonly storage: Storage; readonly value: StoredComposer }
	| { readonly kind: 'invalid'; readonly storage: Storage }
	| { readonly kind: 'unavailable'; readonly error: unknown }

const COMPOSER_STORAGE_KEY_PREFIX = 'remobi:composer:v1:'
const DRAFT_RESTORE_FAILURE = 'Draft could not be restored; stored copy left untouched.'
const DRAFT_CORRUPT_RESET = 'Draft storage was corrupt and has been reset; your text is saved.'
const DRAFT_STORAGE_FAILURE = 'Draft is not protected on this device.'

function composerStorageKey(): string {
	const basePath = typeof __remobiBasePath === 'undefined' ? '/' : (__remobiBasePath ?? '/')
	return `${COMPOSER_STORAGE_KEY_PREFIX}${basePath}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function readComposerStore(): StorageReadResult {
	let storage: Storage
	try {
		storage = window.localStorage
	} catch (error: unknown) {
		return { kind: 'unavailable', error }
	}

	let raw: string | null
	try {
		raw = storage.getItem(composerStorageKey())
	} catch (error: unknown) {
		return { kind: 'unavailable', error }
	}
	if (raw === null) return { kind: 'missing', storage }

	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return { kind: 'invalid', storage }
	}
	if (!isRecord(parsed) || parsed.version !== 1 || typeof parsed.draft !== 'string') {
		return { kind: 'invalid', storage }
	}

	return {
		kind: 'valid',
		storage,
		value: {
			version: 1,
			draft: parsed.draft,
			pending: Object.hasOwn(parsed, 'pending') ? parsed.pending : null,
		},
	}
}

export interface AsrPreview {
	readonly element: HTMLDivElement
	readonly input: HTMLTextAreaElement
	readonly message: HTMLDivElement
	readonly isOpen: () => boolean
	/** @deprecated Use isOpen; retained for existing preview consumers. */
	readonly isVisible: () => boolean
	readonly getText: () => string
	open(): void
	close(): void
	readonly show: (text: string) => void
	readonly setPartial: (text: string) => void
	readonly showMessage: (message: string) => void
	readonly restoreDraft: () => void
	readonly resetDraft: () => void
	readonly clear: () => void
	readonly onOpenChange: (handler: (open: boolean) => void) => { dispose(): void }
	readonly onHeightChange: (handler: () => void) => { dispose(): void }
	readonly onConfirm: (handler: () => void) => { dispose(): void }
	readonly onCancel: (handler: () => void) => { dispose(): void }
}

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

/** Create the two-layer voice composer; opening it never focuses or starts ASR. */
export function createAsrPreview(): AsrPreview {
	const element = el('div', {
		id: 'wt-asr-composer',
		role: 'dialog',
		'aria-modal': 'false',
		'aria-label': 'Voice composer',
	})
	element.style.display = 'none'

	const panel = el('div', { id: 'wt-asr-composer-panel' })
	const closeButton = el('button', {
		type: 'button',
		class: 'wt-asr-composer-close',
		'aria-label': 'Close voice composer',
	})
	closeButton.textContent = '×'

	const input = el('textarea', {
		rows: '1',
		wrap: 'soft',
		placeholder: 'Speak or type…',
		'aria-label': 'Voice composer input',
		autocomplete: 'off',
	})
	const message = el('div', { class: 'wt-asr-composer-message', 'aria-live': 'polite' })
	const actions = el('div', { class: 'wt-asr-composer-actions' })
	const micButton = el('button', {
		type: 'button',
		class: 'wt-composer-mic',
		'aria-label': 'Toggle microphone',
		'aria-pressed': 'false',
		'data-remobi-control': 'composer-mic',
	})
	micButton.appendChild(createMicIcon())
	const sendButton = el('button', {
		type: 'button',
		class: 'wt-composer-send',
	})
	sendButton.textContent = 'Send'
	actions.append(closeButton, micButton, sendButton)

	panel.append(input, message, actions)
	element.appendChild(panel)

	let open = false
	let pendingPartial: string | undefined
	let partialFrame: number | undefined
	let storageFailureShown = false
	const openChangeHandlers = new Set<(open: boolean) => void>()
	const heightChangeHandlers = new Set<() => void>()
	let inputHeight = ''

	function resizeInput(): void {
		const previousHeight = inputHeight
		input.style.height = 'auto'
		const nextHeight = `${Math.min(Math.max(input.scrollHeight, 48), 168)}px`
		input.style.height = nextHeight
		inputHeight = nextHeight
		if (nextHeight !== previousHeight) {
			for (const handler of heightChangeHandlers) handler()
		}
	}

	function showStorageFailure(error: unknown): void {
		if (storageFailureShown) return
		storageFailureShown = true
		console.error('remobi: composer draft storage unavailable', error)
		message.textContent = DRAFT_STORAGE_FAILURE
	}

	function showRestoreFailure(): void {
		message.textContent = DRAFT_RESTORE_FAILURE
	}

	function persistDraft(draft: string): void {
		const stored = readComposerStore()
		if (stored.kind === 'unavailable') {
			showStorageFailure(stored.error)
			return
		}
		const corrupt = stored.kind === 'invalid'
		const pending = stored.kind === 'valid' ? stored.value.pending : null
		try {
			stored.storage.setItem(
				composerStorageKey(),
				JSON.stringify({ version: 1 satisfies ComposerStore['version'], draft, pending }),
			)
			if (corrupt) showMessage(DRAFT_CORRUPT_RESET)
		} catch (error: unknown) {
			showStorageFailure(error)
		}
	}

	input.addEventListener('input', () => {
		resizeInput()
		persistDraft(input.value)
	})

	function setOpen(next: boolean): void {
		if (open === next) return
		open = next
		element.style.display = next ? 'flex' : 'none'
		element.setAttribute('aria-hidden', next ? 'false' : 'true')
		document.body.classList.toggle('wt-composer-open', next)
		for (const handler of openChangeHandlers) handler(next)
	}

	function openComposer(): void {
		input.readOnly = false
		setOpen(true)
		resizeInput()
	}

	function closeComposer(): void {
		setOpen(false)
	}

	function renderText(text: string, persist: boolean): void {
		input.value = text
		message.textContent = ''
		setOpen(true)
		resizeInput()
		if (persist) persistDraft(text)
	}

	function show(text: string): void {
		renderText(text, true)
	}

	function setPartial(text: string): void {
		pendingPartial = text
		if (partialFrame !== undefined) return
		partialFrame = requestAnimationFrame(() => {
			partialFrame = undefined
			if (pendingPartial !== undefined) renderText(pendingPartial, false)
			pendingPartial = undefined
		})
	}

	function showMessage(text: string): void {
		message.textContent = text
		setOpen(true)
	}

	function resetDraft(): void {
		if (partialFrame !== undefined) cancelAnimationFrame(partialFrame)
		partialFrame = undefined
		pendingPartial = undefined
		input.value = ''
		message.textContent = ''
		resizeInput()
		persistDraft('')
	}

	function clear(): void {
		resetDraft()
		setOpen(false)
	}

	function restoreDraft(): void {
		if (input.value) return
		const stored = readComposerStore()
		if (stored.kind === 'invalid') {
			showRestoreFailure()
			return
		}
		if (stored.kind === 'unavailable') {
			showStorageFailure(stored.error)
			return
		}
		if (stored.kind === 'missing' || !stored.value.draft) return
		input.value = stored.value.draft
		resizeInput()
	}

	function register(target: HTMLButtonElement, handler: () => void): { dispose(): void } {
		const callback = (event: Event): void => {
			event.stopPropagation()
			handler()
		}
		onTap(target, callback)
		return {
			dispose() {
				target.removeEventListener('click', callback)
				target.removeEventListener('touchend', callback)
			},
		}
	}

	function registerCancel(handler: () => void): { dispose(): void } {
		const callback = (event: Event): void => {
			event.stopPropagation()
			handler()
		}
		onTap(closeButton, callback)
		return {
			dispose() {
				closeButton.removeEventListener('click', callback)
				closeButton.removeEventListener('touchend', callback)
			},
		}
	}

	restoreDraft()

	return {
		element,
		input,
		message,
		isOpen: () => open,
		isVisible: () => open,
		getText: () => input.value,
		open: openComposer,
		close: closeComposer,
		show,
		setPartial,
		showMessage,
		restoreDraft,
		resetDraft,
		clear,
		onOpenChange(handler) {
			openChangeHandlers.add(handler)
			return { dispose: () => openChangeHandlers.delete(handler) }
		},
		onHeightChange(handler) {
			heightChangeHandlers.add(handler)
			return { dispose: () => heightChangeHandlers.delete(handler) }
		},
		onConfirm: (handler) => register(sendButton, handler),
		onCancel: registerCancel,
	}
}
