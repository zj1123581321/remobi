import { expect, test } from '@playwright/test'

async function waitForState(page: import('@playwright/test').Page, state: string): Promise<void> {
	await expect
		.poll(() => page.evaluate(() => window.term?.getConnectionStatus?.()?.state), {
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
	await page.goto('/')
	await page.waitForSelector('#terminal .xterm')
	await waitForSynced(page)

	await context.setOffline(true)
	await page.evaluate(() => window.__remobiSockets?.[0]?.close())
	await waitForState(page, 'reconnecting')
	await page.screenshot({ path: 'test-results/weak-network-reconnecting.png' })
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
	await page.goto('/')
	await page.waitForSelector('#terminal .xterm')
	await waitForSynced(page)

	const marker = `fresh-snapshot-${Date.now()}`
	await page.evaluate((value) => window.term?.input(`printf "${value}\\n"\r`, true), marker)
	await expect(page.locator('body')).toContainText(marker)

	await context.setOffline(true)
	await page.evaluate(() => window.__remobiSockets?.[0]?.close())
	await waitForState(page, 'reconnecting')
	await page.screenshot({ path: 'test-results/weak-network-disconnected.png' })
	await context.setOffline(false)
	await page.screenshot({ path: 'test-results/weak-network-syncing.png' })
	await waitForSynced(page)
	await expect(page.locator('body')).toContainText(marker)
})
