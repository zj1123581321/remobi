import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createAsrPreview } from '../src/controls/asr-preview'
import { _resetTouchGuard } from '../src/util/tap'

beforeEach(() => GlobalRegistrator.register())

afterEach(() => {
	_resetTouchGuard()
	GlobalRegistrator.unregister()
})

describe('voice composer shell', () => {
	test('has ordinary text input and opens without focusing it', () => {
		const composer = createAsrPreview()
		document.body.appendChild(composer.element)

		expect(composer.element.id).toBe('wt-asr-composer')
		expect(composer.input.placeholder).toBe('Speak or type…')
		expect(composer.element.querySelector('[data-remobi-control="composer-mic"]')).not.toBeNull()
		expect(composer.element.querySelector('.wt-composer-send')?.textContent).toBe('Send')
		expect(composer.element.querySelector('.wt-asr-composer-close')).not.toBeNull()
		composer.open()

		expect(composer.isOpen()).toBe(true)
		expect(composer.input.readOnly).toBe(false)
		expect(document.activeElement).not.toBe(composer.input)
		composer.close()
		expect(composer.isOpen()).toBe(false)
	})

	test('clear discards text and hides the composer', () => {
		const composer = createAsrPreview()
		composer.open()
		composer.input.value = 'discarded'
		composer.showMessage('status')
		composer.clear()

		expect(composer.getText()).toBe('')
		expect(composer.message.textContent).toBe('')
		expect(composer.isOpen()).toBe(false)
	})
})
