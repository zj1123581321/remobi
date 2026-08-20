import { el, svg } from '../util/dom'
import { onTap } from '../util/tap'

export interface AsrPreview {
	readonly element: HTMLDivElement
	readonly input: HTMLInputElement
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
	readonly clear: () => void
	readonly onOpenChange: (handler: (open: boolean) => void) => { dispose(): void }
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

	const input = el('input', {
		type: 'text',
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
	const openChangeHandlers = new Set<(open: boolean) => void>()

	function setOpen(next: boolean): void {
		if (open === next) return
		open = next
		element.style.display = next ? 'flex' : 'none'
		element.setAttribute('aria-hidden', next ? 'false' : 'true')
		document.body.classList.toggle('wt-composer-open', next)
		for (const handler of openChangeHandlers) handler(next)
	}

	function openComposer(): void {
		input.value = ''
		message.textContent = ''
		input.readOnly = false
		setOpen(true)
	}

	function closeComposer(): void {
		setOpen(false)
	}

	function show(text: string): void {
		input.value = text
		message.textContent = ''
		setOpen(true)
	}

	function setPartial(text: string): void {
		pendingPartial = text
		if (partialFrame !== undefined) return
		partialFrame = requestAnimationFrame(() => {
			partialFrame = undefined
			if (pendingPartial !== undefined) show(pendingPartial)
			pendingPartial = undefined
		})
	}

	function showMessage(text: string): void {
		message.textContent = text
		setOpen(true)
	}

	function clear(): void {
		if (partialFrame !== undefined) cancelAnimationFrame(partialFrame)
		partialFrame = undefined
		pendingPartial = undefined
		input.value = ''
		message.textContent = ''
		setOpen(false)
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
		clear,
		onOpenChange(handler) {
			openChangeHandlers.add(handler)
			return { dispose: () => openChangeHandlers.delete(handler) }
		},
		onConfirm: (handler) => register(sendButton, handler),
		onCancel: registerCancel,
	}
}
