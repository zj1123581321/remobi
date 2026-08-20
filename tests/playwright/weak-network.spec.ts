import { expect, test } from '@playwright/test'

async function installSocketProbe(page: import('@playwright/test').Page): Promise<void> {
	await page.addInitScript(() => {
		const browserWindow = window as typeof window & {
			__remobiSentFrames?: string[]
			__remobiBufferedSamples?: number[]
			__remobiSocketConstructs?: number
		}
		browserWindow.__remobiSentFrames = []
		browserWindow.__remobiBufferedSamples = []
		browserWindow.__remobiSocketConstructs = 0
		const NativeWebSocket = window.WebSocket
		const NativeSend = NativeWebSocket.prototype.send
		NativeWebSocket.prototype.send = function (
			data: string | ArrayBufferLike | Blob | ArrayBufferView,
		) {
			const before = this.bufferedAmount
			if (typeof data === 'string') browserWindow.__remobiSentFrames?.push(data)
			const result = NativeSend.call(this, data)
			browserWindow.__remobiBufferedSamples?.push(before, this.bufferedAmount)
			return result
		}
		// biome-ignore lint/complexity/useArrowFunction: WebSocket replacement must remain constructable
		const TrackedWebSocket = function (...args: ConstructorParameters<typeof WebSocket>) {
			browserWindow.__remobiSocketConstructs = (browserWindow.__remobiSocketConstructs ?? 0) + 1
			return new NativeWebSocket(...args)
		} as unknown as typeof WebSocket
		Object.setPrototypeOf(TrackedWebSocket, NativeWebSocket)
		TrackedWebSocket.prototype = NativeWebSocket.prototype
		window.WebSocket = TrackedWebSocket
	})
}

async function getSentFrames(page: import('@playwright/test').Page): Promise<string[]> {
	return page.evaluate(() => {
		const browserWindow = window as typeof window & { __remobiSentFrames?: string[] }
		return browserWindow.__remobiSentFrames ?? []
	})
}

async function getBufferedSamples(page: import('@playwright/test').Page): Promise<number[]> {
	return page.evaluate(() => {
		const browserWindow = window as typeof window & { __remobiBufferedSamples?: number[] }
		return browserWindow.__remobiBufferedSamples ?? []
	})
}

async function getSocketConstructs(page: import('@playwright/test').Page): Promise<number> {
	return page.evaluate(() => {
		const browserWindow = window as typeof window & { __remobiSocketConstructs?: number }
		return browserWindow.__remobiSocketConstructs ?? 0
	})
}

async function waitForState(page: import('@playwright/test').Page, state: string): Promise<void> {
	await expect
		.poll(() => page.evaluate(() => window.term?.getConnectionStatus().state), {
			timeout: 15_000,
		})
		.toBe(state)
}

async function waitForSynced(page: import('@playwright/test').Page): Promise<void> {
	await waitForState(page, 'synced')
}

test('offline keyboard input is dropped and recovery requires a fresh synced snapshot', async ({
	page,
	context,
}) => {
	await installSocketProbe(page)
	await page.goto('/')
	await page.waitForSelector('#terminal .xterm')
	await waitForSynced(page)

	await context.setOffline(true)
	await page.evaluate(() => window.__remobiSockets?.[0]?.close())
	await waitForState(page, 'disconnected')
	await page.screenshot({ path: 'test-results/weak-network-disconnected.png' })
	await page.evaluate(() => {
		;(document.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null)?.focus()
	})
	const offlineInput = `offline-input-${Date.now()}`
	await page.keyboard.type(offlineInput)
	await page.keyboard.press('Enter')

	await context.setOffline(false)
	await waitForSynced(page)
	await expect(page.locator('body')).not.toContainText(offlineInput)
	await page.screenshot({ path: 'test-results/weak-network-synced.png' })
})

test('offline and online recovery converges to the server snapshot', async ({ page, context }) => {
	await installSocketProbe(page)
	await page.goto('/')
	await page.waitForSelector('#terminal .xterm')
	await waitForSynced(page)

	const marker = `fresh-snapshot-${Date.now()}`
	await page.evaluate((value) => window.term?.input(`printf "${value}\\n"\r`, true), marker)
	await expect(page.locator('body')).toContainText(marker)
	await page.evaluate(() => {
		;(document.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null)?.focus()
	})
	const keyboardMarker = `normal-keyboard-${Date.now()}`
	await page.keyboard.type(`printf "${keyboardMarker}\\n"`)
	await page.keyboard.press('Enter')
	await expect(page.locator('body')).toContainText(keyboardMarker)
	const bufferedSamples = await getBufferedSamples(page)
	expect(bufferedSamples.length).toBeGreaterThan(0)
	console.log(`normal-network bufferedAmount samples: ${JSON.stringify(bufferedSamples)}`)
	await page.waitForTimeout(250)
	const bufferedAtRest = await page.evaluate(
		() => window.__remobiSockets?.[0]?.bufferedAmount ?? -1,
	)
	console.log(`normal-network bufferedAmount after 250ms: ${bufferedAtRest}`)
	expect(bufferedAtRest).toBe(0)

	await context.setOffline(true)
	await page.evaluate(() => window.__remobiSockets?.[0]?.close())
	await waitForState(page, 'disconnected')
	await page.screenshot({ path: 'test-results/weak-network-disconnected.png' })
	await context.setOffline(false)
	await page.screenshot({ path: 'test-results/weak-network-syncing.png' })
	await waitForSynced(page)
	await expect(page.locator('body')).toContainText(marker)
})

test('offline event invalidates an OPEN socket before keyboard input is sent', async ({
	page,
	context,
}) => {
	await installSocketProbe(page)
	await page.goto('/')
	await page.waitForSelector('#terminal .xterm')
	await waitForSynced(page)
	const sentBefore = (await getSentFrames(page)).length

	await context.setOffline(true)
	await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
	await waitForState(page, 'disconnected')
	await page.evaluate(() => {
		;(document.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null)?.focus()
	})
	const marker = `offline-open-${Date.now()}`
	await page.keyboard.type(marker)
	await page.keyboard.press('Enter')
	const sentAfter = await getSentFrames(page)
	expect(sentAfter.length).toBe(sentBefore)

	await context.setOffline(false)
	await waitForSynced(page)
	await expect(page.locator('body')).not.toContainText(marker)
})

test('freeze and resume events force a fresh epoch and snapshot', async ({ page }) => {
	await installSocketProbe(page)
	await page.goto('/')
	await page.waitForSelector('#terminal .xterm')
	await waitForSynced(page)
	const socketCountBefore = await getSocketConstructs(page)
	// Page.setWebLifecycleState does not reliably dispatch DOM lifecycle events in this Chromium build.
	await page.evaluate(() => document.dispatchEvent(new Event('freeze')))
	await waitForState(page, 'disconnected')
	await page.evaluate(() => document.dispatchEvent(new Event('resume')))

	await expect
		.poll(() => page.evaluate(() => window.term?.getConnectionStatus().state), {
			timeout: 10_000,
		})
		.toMatch(/reconnecting|syncing/)
	await expect
		.poll(() => getSocketConstructs(page), { timeout: 15_000 })
		.toBeGreaterThan(socketCountBefore)
	await waitForSynced(page)
})
