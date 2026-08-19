import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import asrConfig from './asr.config'
import { startIsolatedServe } from './isolated-serve'

const repoRoot = join(import.meta.dirname, '../..')
const configPath = join(repoRoot, 'tests/playwright/asr.config.ts')
const voiceButton = asrConfig.toolbar.row1.at(0)
if (!voiceButton) throw new Error('ASR e2e config must define a voice-input toolbar button')

function serverFrame(flags: 0 | 1 | 3, text: string, sequence = 1): Buffer {
	const payload = Buffer.from(JSON.stringify({ result: { text } }), 'utf8')
	const sequenceBytes = flags === 1 || flags === 3 ? 4 : 0
	const result = Buffer.alloc(8 + sequenceBytes + payload.byteLength)
	result.set([0x11, 0x90 | flags, 0x10, 0], 0)
	if (sequenceBytes > 0) result.writeInt32BE(sequence, 4)
	result.writeUInt32BE(payload.byteLength, 4 + sequenceBytes)
	payload.copy(result, 8 + sequenceBytes)
	return result
}

function frameType(message: string | Buffer): { readonly type: number; readonly flags: number } {
	const bytes = typeof message === 'string' ? Buffer.from(message, 'binary') : message
	return { type: (bytes[1] ?? 0) >> 4, flags: (bytes[1] ?? 0) & 0x0f }
}

test.describe('PTT voice input', () => {
	test.skip(({ browserName }) => browserName !== 'chromium', 'full PTT flow is chromium-only')
	let server: Awaited<ReturnType<typeof startIsolatedServe>> | undefined

	test.beforeAll(async () => {
		server = await startIsolatedServe({ configPath })
	})
	test.afterAll(async () => {
		await server?.close()
	})

	test('fake microphone → mock partial/final → PTY receives sanitized command bytes', async ({
		page,
	}) => {
		if (!server) throw new Error('PTT test server was not started')
		const partial = serverFrame(0, 'partial')
		const asrFrames: Buffer[] = []
		let currentText = ''
		await page.routeWebSocket('wss://openspeech.bytedance.com/**', (socket) => {
			let partialSent = false
			const final = (): Buffer => serverFrame(3, currentText, 1)
			socket.onMessage((message) => {
				if (typeof message === 'string') return
				const buffer = Buffer.isBuffer(message) ? message : Buffer.from(message)
				asrFrames.push(buffer)
				const frame = frameType(buffer)
				if (frame.type !== 2) return
				if (frame.flags === 2 || frame.flags === 3) socket.send(final())
				else if (!partialSent) {
					partialSent = true
					socket.send(partial)
				}
			})
		})

		for (let attempt = 0; attempt < 5; attempt++) {
			currentText = `printf "ptt-e2e-${attempt}\\n"`
			const suffix = attempt === 0 ? '' : `-${attempt}`
			await page.goto(server.url)
			await page.waitForSelector('#wt-toolbar [data-remobi-action="voice-input"]')
			const mic = page.locator('[data-remobi-action="voice-input"]')
			await expect(mic).toBeVisible()
			await expect(mic).toContainText(voiceButton.label)

			await mic.dispatchEvent('pointerdown', { pointerId: 1, bubbles: true })
			await page.waitForTimeout(450)
			await expect(mic).toHaveAttribute('data-mic-state', 'recording')
			await page.screenshot({ path: `test-results/ptt-recording${suffix}.png` })

			await mic.dispatchEvent('pointerup', { pointerId: 1, bubbles: true })
			await expect(page.locator('#wt-asr-preview')).toBeVisible({ timeout: 5_000 })
			await expect(page.locator('#wt-asr-preview input')).toHaveValue(currentText, {
				timeout: 5_000,
			})
			await page.screenshot({ path: `test-results/ptt-preview${suffix}.png` })

			await page.locator('#wt-asr-preview button', { hasText: 'Send' }).click()
			await expect(page.locator('body')).toContainText(`ptt-e2e-${attempt}`, { timeout: 5_000 })
			await page.screenshot({ path: `test-results/ptt-injected${suffix}.png` })
		}
		expect(asrFrames.some((frame) => ((frame[1] ?? 0) & 0x0f) === 3)).toBe(true)
	})
})

test.describe('PTT capability degradation', () => {
	test('webkit hides voice input when getUserMedia is unavailable', async ({
		page,
		browserName,
	}) => {
		test.skip(browserName !== 'webkit', 'capability degradation is webkit-only')
		await page.addInitScript(() => {
			Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
		})
		const server = await startIsolatedServe({ configPath })
		try {
			await page.goto(server.url)
			await page.waitForSelector('#wt-toolbar')
			await expect(page.locator('[data-remobi-action="voice-input"]')).toHaveCount(0)
		} finally {
			await server.close()
		}
	})
})
