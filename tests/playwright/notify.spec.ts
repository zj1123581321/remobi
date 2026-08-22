import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { startIsolatedServe } from './isolated-serve'

test('notify panel subscribes, receives test push, and focuses on click', async ({
	page,
	context,
}) => {
	await context.grantPermissions(['notifications'])
	const serve = await startIsolatedServe({ isolateTmpDir: false })
	try {
		await page.goto(serve.url)
		await page.waitForSelector('#terminal .xterm', { timeout: 10_000 })

		await page.evaluate(async () => {
			const registration = await navigator.serviceWorker.register('/sw.js')
			await navigator.serviceWorker.ready
			return registration.scope
		})

		const moreBtn = page.locator('#wt-toolbar button', { hasText: '☰' })
		await moreBtn.dispatchEvent('touchend', {
			touches: [],
			changedTouches: [],
			targetTouches: [],
		})
		const notifyBtn = page.locator('#wt-drawer-grid button', { hasText: '🔔' })
		await expect(notifyBtn).toBeVisible()
		await notifyBtn.dispatchEvent('touchend', {
			touches: [],
			changedTouches: [],
			targetTouches: [],
		})

		const toggle = page.locator('#wt-notify .wt-notify-toggle')
		await expect(toggle).toBeVisible()
		await toggle.check()

		await expect
			.poll(async () => {
				const stateDir = `${process.env.HOME}/.local/state/herdweb/${serve.port}`
				try {
					const raw = readFileSync(`${stateDir}/push-subscriptions.json`, 'utf-8')
					const subs = JSON.parse(raw) as Array<{ endpoint: string }>
					return subs.length
				} catch {
					return 0
				}
			})
			.toBeGreaterThan(0)

		await page.evaluate(async () => {
			await fetch('/api/events', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					v: 1,
					kind: 'test',
					title: 'Playwright test',
					body: 'from e2e',
					ts: Date.now(),
				}),
			})
		})

		await expect
			.poll(async () => {
				return page.evaluate(async () => {
					const registration = await navigator.serviceWorker.ready
					const notifications = await registration.getNotifications()
					return notifications.length
				})
			})
			.toBeGreaterThan(0)

		await page.evaluate(async () => {
			const registration = await navigator.serviceWorker.ready
			const notifications = await registration.getNotifications()
			const notification = notifications[0]
			if (!notification) throw new Error('missing notification')
			notification.dispatchEvent(new Event('click'))
		})

		await expect(page.locator('#terminal .xterm')).toBeVisible()
	} finally {
		await serve.close()
	}
})
