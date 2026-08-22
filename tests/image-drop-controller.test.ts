import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
	type ImageDropController,
	createImageDropController,
} from '../src/controls/image-drop-controller'
import type { InputActionResult } from '../src/types'

beforeEach(() => GlobalRegistrator.register())
afterEach(() => {
	vi.useRealTimers()
	GlobalRegistrator.unregister()
})

const PATH = '/tmp/herdweb-drop-1.png'
const png = () => new File(['x'], 'a.png', { type: 'image/png' })
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function jsonResponse(body: unknown, status = 200): Response {
	return { ok: status === 200, status, json: () => Promise.resolve(body) } as unknown as Response
}

function setup() {
	const sent: Array<{ id: string; data: string }> = []
	const listeners = new Set<(result: InputActionResult) => void>()
	const session = { id: 's1' as string | null, connected: true }
	let aid = 0
	const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ path: PATH })))
	const writeText = vi.fn(() => Promise.resolve())
	const controller = createImageDropController({
		term: {
			getSessionId: () => session.id,
			isConnected: () => session.connected,
			sendInputAction: (id: string, data: string) => {
				sent.push({ id, data })
				return true
			},
			onInputActionResult: (handler: (result: InputActionResult) => void) => {
				listeners.add(handler)
				return { dispose: () => listeners.delete(handler) }
			},
		},
		basePath: '/herdweb',
		fetchFn: fetchMock as unknown as typeof fetch,
		clipboard: { writeText },
		createActionId: () => {
			aid += 1
			return `a${aid}`
		},
		ackTimeoutMs: 30,
	})
	const emit = (result: InputActionResult) => {
		for (const listener of listeners) listener(result)
	}
	return { controller, session, sent, emit, fetchMock, writeText }
}

function query<T extends HTMLElement>(c: ImageDropController, sel: string): T {
	const found = c.element.querySelector<T>(sel)
	if (!found) throw new Error(`missing ${sel}`)
	return found
}

const statusText = (c: ImageDropController) => query(c, '.wt-image-drop-status').textContent

function pick(c: ImageDropController, file: File | null): void {
	const input = query<HTMLInputElement>(c, 'input')
	Object.defineProperty(input, 'files', { value: file ? [file] : [], configurable: true })
	input.dispatchEvent(new Event('change'))
}

test('picker: cancel hides the panel; reset allows re-select; single-flight; raw File POST', async () => {
	const h = setup()
	const clickSpy = vi.spyOn(query<HTMLInputElement>(h.controller, 'input'), 'click')
	h.controller.open()
	pick(h.controller, null)
	expect(h.controller.element.style.display).toBe('none')
	h.controller.open()
	const file = png()
	pick(h.controller, file)
	h.controller.open() // ignored — upload in flight (single-flight)
	await flush()
	expect(clickSpy).toHaveBeenCalledTimes(2)
	expect(h.fetchMock).toHaveBeenCalledTimes(1)
	expect(h.fetchMock).toHaveBeenCalledWith('/herdweb/api/image-drop', {
		method: 'POST',
		body: file,
	})
	expect(query<HTMLInputElement>(h.controller, 'input').value).toBe('')
	pick(h.controller, png())
	await flush()
	expect(h.fetchMock).toHaveBeenCalledTimes(2)
})

test('failures: HTTP status, malformed 200, rejected, lost ACK — all keep a visible safe state', async () => {
	for (const status of [415, 500]) {
		const h = setup()
		h.fetchMock.mockResolvedValue(jsonResponse({}, status))
		pick(h.controller, png())
		await flush()
		expect(statusText(h.controller)).toContain(`HTTP ${status}`)
		expect(h.controller.element.style.display).toBe('flex')
	}
	const bad = setup()
	bad.fetchMock.mockResolvedValueOnce({
		ok: true,
		status: 200,
		json: () => Promise.reject(new Error('bad')),
	} as unknown as Response)
	pick(bad.controller, png())
	await flush()
	expect(statusText(bad.controller)).toContain('bad response')
	bad.fetchMock.mockResolvedValueOnce(jsonResponse({}))
	pick(bad.controller, png())
	await flush()
	expect(statusText(bad.controller)).toContain('no path')
	// rejected insert returns to file-ready with the path still shown
	const h = setup()
	pick(h.controller, png())
	await flush()
	h.emit({ id: 'image-drop-a1', accepted: false, reason: 'id-conflict' })
	expect(statusText(h.controller)).toContain('Insert rejected (id-conflict)')
	expect(query(h.controller, '.wt-image-drop-path').textContent).toBe(PATH)
	const retryBtn = query<HTMLButtonElement>(h.controller, '.wt-image-drop-retry')
	expect(retryBtn.disabled).toBe(false)
	retryBtn.click() // retry in the same session reuses the actionId (server dedupes)
	expect(h.sent.map((s) => s.id)).toEqual(['image-drop-a1', 'image-drop-a1'])
	// lost ACK times out back to file-ready
	vi.useFakeTimers()
	h.emit({ id: 'image-drop-a1', accepted: false, reason: 'id-conflict' })
	retryBtn.click()
	await vi.advanceTimersByTimeAsync(31)
	expect(statusText(h.controller)).toContain('No confirmation')
	expect(retryBtn.disabled).toBe(false)
})

test('gating: session/freshness guard auto-insert; stale ACKs and clipboard feedback are safe', async () => {
	const h = setup()
	pick(h.controller, png())
	await flush()
	expect(h.sent).toEqual([{ id: 'image-drop-a1', data: ` ${PATH} ` }])
	h.emit({ id: 'image-drop-a1', accepted: true, reason: null })
	expect(statusText(h.controller)).toContain('Inserted')
	// a stale ACK must not end a newer selection
	query<HTMLButtonElement>(h.controller, '.wt-image-drop-close').click()
	pick(h.controller, png())
	await flush()
	h.emit({ id: 'image-drop-a1', accepted: true, reason: null })
	expect(statusText(h.controller)).toContain('Inserting')
	h.emit({ id: 'image-drop-a2', accepted: true, reason: null })
	expect(statusText(h.controller)).toContain('Inserted')
	// changed, empty, or unsynced session: never auto-insert
	pick(h.controller, png())
	h.session.id = 's2'
	await flush()
	expect(h.sent).toHaveLength(2)
	expect(statusText(h.controller)).toContain('session changed')
	h.session.id = null
	pick(h.controller, png())
	await flush()
	expect(h.sent).toHaveLength(2)
	h.session.id = 's1'
	h.session.connected = false
	pick(h.controller, png())
	await flush()
	expect(h.sent).toHaveLength(2)
	expect(statusText(h.controller)).toContain('not synced')
	// clipboard denial and success are both visible
	h.writeText.mockRejectedValueOnce(new Error('denied'))
	query<HTMLButtonElement>(h.controller, '.wt-image-drop-copy').click()
	await flush()
	expect(statusText(h.controller)).toContain('Copy failed')
	query<HTMLButtonElement>(h.controller, '.wt-image-drop-copy').click()
	await flush()
	expect(statusText(h.controller)).toContain('Copied')
})

test('done toast: no path/buttons, auto-hides after ~2.5s, newer pick survives the old timer', async () => {
	const h = setup()
	vi.useFakeTimers()
	const pathText = query(h.controller, '.wt-image-drop-path')
	const actions = query(h.controller, '.wt-image-drop-actions')

	pick(h.controller, png())
	await vi.advanceTimersByTimeAsync(0) // upload resolves → auto-insert
	expect(h.sent).toHaveLength(1)
	h.emit({ id: 'image-drop-a1', accepted: true, reason: null })
	expect(statusText(h.controller)).toBe('Inserted into agent input.')
	expect(h.controller.element.style.display).toBe('flex')
	// the toast is bare: no path text, no action buttons
	expect(pathText.style.display).toBe('none')
	expect(actions.style.display).toBe('none')
	// auto-hide at ~2.5s, not before
	await vi.advanceTimersByTimeAsync(2_499)
	expect(h.controller.element.style.display).toBe('flex')
	await vi.advanceTimersByTimeAsync(1)
	expect(h.controller.element.style.display).toBe('none')

	// a pick made during the toast must not be hidden by the stale toast timer
	pick(h.controller, png())
	await vi.advanceTimersByTimeAsync(0)
	h.emit({ id: 'image-drop-a2', accepted: true, reason: null })
	expect(statusText(h.controller)).toContain('Inserted')
	await vi.advanceTimersByTimeAsync(1_000) // mid-toast
	pick(h.controller, png())
	await vi.advanceTimersByTimeAsync(0)
	expect(statusText(h.controller)).toContain('Inserting')
	await vi.advanceTimersByTimeAsync(2_000) // the old toast timer would have fired here
	expect(h.controller.element.style.display).toBe('flex')
})
