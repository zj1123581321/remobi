import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createAsrPreview } from '../src/controls/asr-preview'

const COMPOSER_STORAGE_KEY = 'remobi:composer:v1:/'

beforeEach(() => {
	GlobalRegistrator.register()
	localStorage.clear()
})

afterEach(() => {
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
})
