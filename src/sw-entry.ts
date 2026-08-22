/// <reference lib="webworker" />
import type { NotifyEvent } from './notify/events'

/** Build an absolute URL from the service worker scope. */
export function resolveScopeUrl(scope: string, path: string): string {
	const base = scope.endsWith('/') ? scope : `${scope}/`
	const relative = path.startsWith('/') ? path.slice(1) : path
	return new URL(relative, base).toString()
}

/** Show a notification from a parsed push event. */
export function showPushNotification(
	registration: ServiceWorkerRegistration,
	event: NotifyEvent,
): Promise<void> {
	const tag = event.session ? `${event.kind}:${event.session}` : event.kind
	return registration.showNotification(event.title, {
		body: event.body,
		tag,
		data: event,
	})
}

/** Focus an existing window or open the app scope. */
export async function handleNotificationClick(
	clients: Pick<Clients, 'matchAll' | 'openWindow'>,
	scope: string,
): Promise<void> {
	const matched = await clients.matchAll({ type: 'window', includeUncontrolled: true })
	if (matched.length > 0) {
		const first = matched[0]
		if (first) {
			await first.focus()
		}
		return
	}
	await clients.openWindow(scope)
}

/** Re-subscribe after pushsubscriptionchange: fetch VAPID key, replace server record. */
export async function handlePushSubscriptionChange(
	registration: ServiceWorkerRegistration,
	scope: string,
	fetchFn: typeof fetch,
): Promise<void> {
	const previousSub = await registration.pushManager.getSubscription()
	const previousEndpoint = previousSub?.endpoint

	const keyResponse = await fetchFn(resolveScopeUrl(scope, 'api/push/vapid-key'))
	if (!keyResponse.ok) return
	const { publicKey } = (await keyResponse.json()) as { publicKey?: string }
	if (typeof publicKey !== 'string') return

	const applicationServerKey = urlBase64ToUint8Array(publicKey)
	const subscription = await registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
	})

	if (previousEndpoint) {
		await fetchFn(resolveScopeUrl(scope, 'api/push/subscription'), {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ endpoint: previousEndpoint }),
		}).catch(() => {})
	}

	const subscribeResponse = await fetchFn(resolveScopeUrl(scope, 'api/push/subscribe'), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			endpoint: subscription.endpoint,
			keys: {
				p256dh: arrayBufferToBase64(subscription.getKey('p256dh')),
				auth: arrayBufferToBase64(subscription.getKey('auth')),
			},
		}),
	})
	if (!subscribeResponse.ok) {
		await subscription.unsubscribe().catch(() => {})
		throw new Error(`subscribe failed: ${subscribeResponse.status}`)
	}
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
	const raw = atob(base64)
	const output = new Uint8Array(raw.length)
	for (let i = 0; i < raw.length; i++) {
		output[i] = raw.charCodeAt(i)
	}
	return output
}

function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
	if (buffer === null) return ''
	const bytes = new Uint8Array(buffer)
	let binary = ''
	for (const byte of bytes) {
		binary += String.fromCharCode(byte)
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function installHandlers(self: ServiceWorkerGlobalScope): void {
	self.addEventListener('install', () => {
		// v1: no skipWaiting — new workers activate on next navigation.
	})

	self.addEventListener('activate', () => {
		// no-op
	})

	self.addEventListener('push', (event: Event) => {
		const pushEvent = event as PushEvent
		const data = pushEvent.data?.text()
		if (!data) return
		let parsed: NotifyEvent
		try {
			parsed = JSON.parse(data) as NotifyEvent
		} catch {
			return
		}
		pushEvent.waitUntil(showPushNotification(self.registration, parsed))
	})

	self.addEventListener('notificationclick', (event: Event) => {
		const clickEvent = event as NotificationEvent
		clickEvent.notification.close()
		const scope = self.registration.scope
		clickEvent.waitUntil(handleNotificationClick(self.clients, scope))
	})

	self.addEventListener('pushsubscriptionchange', (event: Event) => {
		const changeEvent = event as ExtendableEvent
		const scope = self.registration.scope
		changeEvent.waitUntil(
			handlePushSubscriptionChange(self.registration, scope, self.fetch.bind(self)),
		)
	})
}

declare const self: ServiceWorkerGlobalScope
installHandlers(self)
