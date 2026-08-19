import { el } from '../util/dom'
import { onTap } from '../util/tap'

export interface AsrPreview {
	readonly element: HTMLDivElement
	readonly input: HTMLInputElement
	readonly message: HTMLDivElement
	readonly isVisible: () => boolean
	readonly getText: () => string
	readonly show: (text: string) => void
	readonly setPartial: (text: string) => void
	readonly showMessage: (message: string) => void
	readonly clear: () => void
	readonly onConfirm: (handler: () => void) => { dispose(): void }
	readonly onCancel: (handler: () => void) => { dispose(): void }
}

/** Create the ordinary input-based speech preview; terminal keyboard suppression does not apply. */
export function createAsrPreview(): AsrPreview {
	const element = el('div', {
		id: 'wt-asr-preview',
		role: 'dialog',
		'aria-label': 'Speech preview',
	})
	element.style.display = 'none'
	element.style.position = 'fixed'
	element.style.left = '8px'
	element.style.right = '8px'
	element.style.bottom = '72px'
	element.style.zIndex = '10002'
	element.style.padding = '10px'
	element.style.borderRadius = '10px'
	element.style.background = '#313244'
	element.style.color = '#cdd6f4'
	element.style.boxShadow = '0 4px 18px rgba(0,0,0,.35)'

	const input = el('input', { type: 'text', placeholder: 'Speech preview' })
	input.style.boxSizing = 'border-box'
	input.style.width = '100%'
	input.style.minHeight = '42px'
	input.style.padding = '8px'
	input.style.border = '1px solid #585b70'
	input.style.borderRadius = '6px'
	input.style.background = '#1e1e2e'
	input.style.color = '#cdd6f4'

	const message = el('div', { 'aria-live': 'polite' })
	message.style.minHeight = '1.3em'
	message.style.marginTop = '5px'
	message.style.fontSize = '12px'
	message.style.color = '#f9e2af'

	const actions = el('div')
	actions.style.display = 'flex'
	actions.style.justifyContent = 'flex-end'
	actions.style.gap = '8px'
	actions.style.marginTop = '8px'
	const cancel = el('button', { type: 'button' }, 'Cancel')
	const confirm = el('button', { type: 'button' }, 'Send')
	for (const button of [cancel, confirm]) {
		button.style.minHeight = '40px'
		button.style.padding = '6px 14px'
		button.style.border = '0'
		button.style.borderRadius = '6px'
		button.style.background = '#45475a'
		button.style.color = '#cdd6f4'
	}
	confirm.style.background = '#a6e3a1'
	confirm.style.color = '#1e1e2e'
	actions.append(cancel, confirm)
	element.append(input, message, actions)

	let visible = false
	let pendingPartial: string | undefined
	let partialFrame: number | undefined

	function setVisible(next: boolean): void {
		visible = next
		element.style.display = next ? 'block' : 'none'
	}

	function show(text: string): void {
		input.value = text
		message.textContent = ''
		setVisible(true)
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
		setVisible(true)
	}

	function clear(): void {
		if (partialFrame !== undefined) cancelAnimationFrame(partialFrame)
		partialFrame = undefined
		pendingPartial = undefined
		input.value = ''
		message.textContent = ''
		setVisible(false)
	}

	function register(button: HTMLButtonElement, handler: () => void): { dispose(): void } {
		const callback = (event: Event): void => {
			event.stopPropagation()
			handler()
		}
		onTap(button, callback)
		return {
			dispose() {
				button.removeEventListener('click', callback)
				button.removeEventListener('touchend', callback)
			},
		}
	}

	return {
		element,
		input,
		message,
		isVisible: () => visible,
		getText: () => input.value,
		show,
		setPartial,
		showMessage,
		clear,
		onConfirm: (handler) => register(confirm, handler),
		onCancel: (handler) => register(cancel, handler),
	}
}
