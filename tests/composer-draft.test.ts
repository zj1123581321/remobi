import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createAsrPreview } from '../src/controls/asr-preview'

const COMPOSER_STORAGE_KEY = 'remobi:composer:v1:/'
const DRAFT_RESTORE_FAILURE = 'Draft could not be restored; stored copy left untouched.'
const DRAFT_STORAGE_FAILURE = 'Draft is not protected on this device.'
let localStorageDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
	GlobalRegistrator.register()
	localStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
	localStorage.clear()
})

afterEach(() => {
	if (localStorageDescriptor) Object.defineProperty(window, 'localStorage', localStorageDescriptor)
	localStorageDescriptor = undefined
	vi.restoreAllMocks()
	GlobalRegistrator.unregister()
})

function readStoredComposer(): unknown {
	const raw = localStorage.getItem(COMPOSER_STORAGE_KEY)
	if (raw === null) throw new Error('composer store was not written')
	return JSON.parse(raw) as unknown
}

describe('composer draft persistence', () => {
	test('serialises typed draft with the fixed schema', () => {
		const composer = createAsrPreview()
		composer.input.value = '第一行\n第二行\n第三行'
		composer.input.dispatchEvent(new Event('input', { bubbles: true }))

		expect(readStoredComposer()).toEqual({
			version: 1,
			draft: '第一行\n第二行\n第三行',
			pending: null,
		})
	})

	test('restores a serialised draft when the composer is created', () => {
		localStorage.setItem(
			COMPOSER_STORAGE_KEY,
			JSON.stringify({ version: 1, draft: '长草稿', pending: null }),
		)

		const composer = createAsrPreview()

		expect(composer.getText()).toBe('长草稿')
	})

	test('final text and reset preserve the stored pending value', () => {
		const pending = {
			id: 'a',
			sessionId: 'session',
			sourceText: 'source',
			data: 'data',
			status: 'pending',
		}
		localStorage.setItem(
			COMPOSER_STORAGE_KEY,
			JSON.stringify({ version: 1, draft: 'old', pending }),
		)
		const composer = createAsrPreview()

		composer.show('final text')
		expect(readStoredComposer()).toEqual({ version: 1, draft: 'final text', pending })

		composer.resetDraft()
		expect(readStoredComposer()).toEqual({ version: 1, draft: '', pending })
	})

	test.each([
		['bad JSON', '{ bad JSON'],
		['wrong version', JSON.stringify({ version: 2, draft: 'x', pending: null })],
		['non-string draft', JSON.stringify({ version: 1, draft: 123, pending: null })],
	])('leaves %s stored data untouched when restoration fails', (_label, raw) => {
		localStorage.setItem(COMPOSER_STORAGE_KEY, raw)

		const composer = createAsrPreview()

		expect(composer.getText()).toBe('')
		expect(composer.message.textContent).toBe(DRAFT_RESTORE_FAILURE)
		expect(localStorage.getItem(COMPOSER_STORAGE_KEY)).toBe(raw)
	})

	test('localStorage getter failure is visible and does not escape creation', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		Object.defineProperty(window, 'localStorage', {
			configurable: true,
			get() {
				throw new DOMException('denied', 'SecurityError')
			},
		})

		const composer = createAsrPreview()

		expect(composer.getText()).toBe('')
		expect(composer.message.textContent).toBe(DRAFT_STORAGE_FAILURE)
	})

	test('getItem failure is visible and leaves the textarea usable', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new DOMException('denied', 'SecurityError')
		})

		const composer = createAsrPreview()
		composer.input.value = 'still editable'
		composer.input.dispatchEvent(new Event('input', { bubbles: true }))

		expect(composer.getText()).toBe('still editable')
		expect(composer.message.textContent).toBe(DRAFT_STORAGE_FAILURE)
	})

	test('setItem quota failure retries silently after the first visible warning', () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('full', 'QuotaExceededError')
		})
		const composer = createAsrPreview()

		composer.input.value = 'first draft'
		composer.input.dispatchEvent(new Event('input', { bubbles: true }))
		composer.input.value = 'second draft'
		composer.input.dispatchEvent(new Event('input', { bubbles: true }))

		expect(composer.getText()).toBe('second draft')
		expect(composer.message.textContent).toBe(DRAFT_STORAGE_FAILURE)
		expect(setItem).toHaveBeenCalledTimes(2)
		expect(errorSpy).toHaveBeenCalledTimes(1)
	})
})
