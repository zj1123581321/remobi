import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AsrEngine } from '../src/asr/types'
import { defineConfig } from '../src/config'
import { createMicController } from '../src/controls/mic-controller'
import { createHookRegistry } from '../src/hooks/registry'
import type { InputActionResult, XTerminal } from '../src/types'
import { _resetTouchGuard } from '../src/util/tap'
import { mockTerminalWithSent } from './fixtures'

const engine: AsrEngine = {
	start: () => Promise.resolve(),
	stop: () => Promise.resolve(),
	isSupported: () => true,
	onPartial: () => () => {},
	onFinal: () => () => {},
	onError: () => () => {},
}
type TestTerm = XTerminal & {
	sent: string[]
	emit(result: InputActionResult): void
}

function makeTerm(): TestTerm {
	const base = mockTerminalWithSent()
	const resultHandlers = new Set<(value: InputActionResult) => void>()
	const term = {
		...base,
		sendInputAction(id: string, data: string) {
			base.sendInputAction(id, data)
			return true
		},
		onInputActionResult(handler: (value: InputActionResult) => void) {
			resultHandlers.add(handler)
			return { dispose: () => resultHandlers.delete(handler) }
		},
		emit(result: InputActionResult) {
			for (const handler of resultHandlers) handler(result)
		},
	} satisfies TestTerm
	return term
}

function makeComposer(autoEnter = false, hooks = createHookRegistry()) {
	const term = makeTerm()
	const composer = createMicController({
		term,
		config: defineConfig({ asr: { enabled: true, autoEnter, doubao: { apiKey: 'test' } } }),
		hooks,
		engine,
	})
	if (!composer) throw new Error('composer unavailable')
	const button = document.createElement('button')
	composer.attachComposerToggle(button)
	document.body.append(button)
	button.click()
	return { term, composer }
}
function submit(composer: ReturnType<typeof makeComposer>['composer'], text: string): void {
	composer.preview.input.value = text
	composer.preview.element.querySelector<HTMLButtonElement>('.wt-composer-send')?.click()
}
async function settle(): Promise<void> {
	for (let i = 0; i < 6; i++) await Promise.resolve()
}

beforeEach(() => {
	GlobalRegistrator.register()
	localStorage.clear()
	vi.useFakeTimers()
	vi.stubGlobal('crypto', { randomUUID: () => 'action-1' })
})
afterEach(() => {
	_resetTouchGuard()
	localStorage.clear()
	vi.useRealTimers()
	vi.unstubAllGlobals()
	GlobalRegistrator.unregister()
})

describe('composer action', () => {
	test.each([false, true])(
		'persists before one action and accepted clears it (%s)',
		async (autoEnter) => {
			const { term, composer } = makeComposer(autoEnter)
			let persisted: unknown
			const sendAction = term.sendInputAction.bind(term)
			vi.spyOn(term, 'sendInputAction').mockImplementation((id, data) => {
				persisted = JSON.parse(localStorage.getItem('remobi:composer:v1:/') ?? '{}').pending
				return sendAction(id, data)
			})
			submit(composer, 'hello')
			await settle()
			const stored = JSON.parse(localStorage.getItem('remobi:composer:v1:/') ?? '{}')
			expect(persisted).toEqual(stored.pending)
			expect(term.sent).toEqual([autoEnter ? 'hello\r' : 'hello'])
			term.emit({ id: 'action-1', accepted: true, reason: null })
			expect(JSON.parse(localStorage.getItem('remobi:composer:v1:/') ?? '{}').pending).toBeNull()
			composer.dispose()
		},
	)

	test('unknown retries same ID, rejected only abandons, and same session resends once', async () => {
		const { term, composer } = makeComposer()
		submit(composer, 'hello')
		await settle()
		vi.advanceTimersByTime(15_000)
		composer.preview.element.querySelector<HTMLButtonElement>('.wt-composer-retry')?.click()
		term.emit({ id: 'action-1', accepted: false, reason: 'id-conflict' })
		expect(term.sent).toEqual(['hello', 'hello'])
		expect(composer.preview.message.textContent).toBe('Not received: duplicate submission id.')
		expect(composer.preview.element.querySelector('.wt-composer-retry')).toHaveProperty(
			'hidden',
			true,
		)
		composer.preview.element.querySelector<HTMLButtonElement>('.wt-composer-abandon')?.click()
		expect(JSON.parse(localStorage.getItem('remobi:composer:v1:/') ?? '{}').pending).toBeNull()
		composer.dispose()
	})
})
