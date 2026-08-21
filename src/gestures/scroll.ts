import type { ScrollConfig, XTerminal } from '../types'
import { sendData } from '../util/terminal'
import type { GestureLock } from './lock'
import { resetLock, tryLock } from './lock'

/** Average Y coordinate of two touches */
export function averageY(t0: { clientY: number }, t1: { clientY: number }): number {
	return (t0.clientY + t1.clientY) / 2
}

/** SGR mouse wheel escape sequence for a given direction */
export function scrollSeq(direction: 'up' | 'down', x: number, y: number): string {
	const code = direction === 'up' ? 64 : 65
	return `\x1b[\x3c${code};${x};${y}M`
}

/** Page navigation key sequence for a given direction */
export function pageSeq(direction: 'up' | 'down'): string {
	return direction === 'up' ? '\x1b[5~' : '\x1b[6~'
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value))
}

export function terminalGrid(screenRect: DOMRect, term: XTerminal): { cols: number; rows: number } {
	const colsFromTerm = term.cols
	const rowsFromTerm = term.rows
	if (typeof colsFromTerm === 'number' && typeof rowsFromTerm === 'number') {
		if (colsFromTerm > 0 && rowsFromTerm > 0) {
			return { cols: Math.round(colsFromTerm), rows: Math.round(rowsFromTerm) }
		}
	}

	const measure = document.querySelector('.xterm-char-measure-element')
	if (measure instanceof HTMLElement) {
		const measureRect = measure.getBoundingClientRect()
		if (measureRect.width > 0 && measureRect.height > 0) {
			const cols = Math.max(1, Math.round(screenRect.width / measureRect.width))
			const rows = Math.max(1, Math.round(screenRect.height / measureRect.height))
			return { cols, rows }
		}
	}

	return { cols: 80, rows: 24 }
}

export function touchToCell(
	touch: Touch,
	screen: HTMLElement,
	term: XTerminal,
): { x: number; y: number } {
	const rect = screen.getBoundingClientRect()
	const { cols, rows } = terminalGrid(rect, term)
	const width = Math.max(1, rect.width)
	const height = Math.max(1, rect.height)
	const relX = clamp(touch.clientX - rect.left, 0, width)
	const relY = clamp(touch.clientY - rect.top, 0, height)
	const x = clamp(Math.floor((relX / width) * cols) + 1, 1, cols)
	const y = clamp(Math.floor((relY / height) * rows) + 1, 1, rows)
	return { x, y }
}

export interface ScrollCell {
	readonly x: number
	readonly y: number
}

export interface ScrollTickResult {
	readonly data: string
}

export interface ScrollEngine {
	onTouchStart(nowMs: number): void
	onTouchMove(nowMs: number, dy: number): void
	onTouchEnd(nowMs: number): void
	tick(nowMs: number, cellHeight: number, cell: ScrollCell): ScrollTickResult | null
	readonly pendingPx: number
	readonly isFlinging: boolean
	isAnimationActive(cellHeight: number): boolean
}

function scrollDirection(pendingPx: number): 'up' | 'down' {
	return pendingPx > 0 ? 'up' : 'down'
}

function maxWheelEventsPerFrame(config: ScrollConfig): number {
	return Math.max(1, Math.floor(config.maxLinesPerFrame / config.linesPerWheel))
}

function hasRedeemablePending(
	pendingPx: number,
	cellHeight: number,
	config: ScrollConfig,
): boolean {
	if (pendingPx === 0 || cellHeight <= 0) {
		return false
	}
	const pxPerWheel = (cellHeight * config.linesPerWheel) / config.speedMultiplier
	return pxPerWheel > 0 && Math.abs(pendingPx) >= pxPerWheel
}

function redeemPending(
	pendingPx: number,
	cellHeight: number,
	config: ScrollConfig,
	cell: ScrollCell,
): { pendingPx: number; data: string | null } {
	if (cellHeight <= 0 || pendingPx === 0) {
		return { pendingPx, data: null }
	}

	const pxPerWheel = (cellHeight * config.linesPerWheel) / config.speedMultiplier
	if (pxPerWheel <= 0) {
		return { pendingPx, data: null }
	}

	const wheels = Math.trunc(pendingPx / pxPerWheel)
	if (wheels === 0) {
		return { pendingPx, data: null }
	}

	const maxEvents =
		config.strategy === 'keys' ? config.maxLinesPerFrame : maxWheelEventsPerFrame(config)
	const n = Math.min(Math.abs(wheels), maxEvents)
	const dir = scrollDirection(pendingPx)
	const nextPendingPx = pendingPx - Math.sign(wheels) * n * pxPerWheel

	if (config.strategy === 'keys') {
		const seq = pageSeq(dir)
		return { pendingPx: nextPendingPx, data: seq.repeat(n) }
	}

	const seq = scrollSeq(dir, cell.x, cell.y)
	return { pendingPx: nextPendingPx, data: seq.repeat(n) }
}

/** Pure scroll engine: touch timestamps in, escape sequences out */
export function createScrollEngine(config: ScrollConfig): ScrollEngine {
	let pendingPx = 0
	let velocity = 0
	let isFlinging = false
	let lastMoveAt = 0
	let lastTickAt = 0

	function stopFling(): void {
		isFlinging = false
		velocity = 0
	}

	return {
		get pendingPx() {
			return pendingPx
		},
		get isFlinging() {
			return isFlinging
		},

		isAnimationActive(cellHeight: number): boolean {
			return isFlinging || hasRedeemablePending(pendingPx, cellHeight, config)
		},

		onTouchStart(nowMs: number): void {
			stopFling()
			lastMoveAt = nowMs
			lastTickAt = nowMs
		},

		onTouchMove(nowMs: number, dy: number): void {
			pendingPx += dy
			const dt = Math.max(1, nowMs - lastMoveAt)
			velocity = 0.7 * velocity + 0.3 * (dy / dt)
			lastMoveAt = nowMs
		},

		onTouchEnd(nowMs: number): void {
			lastTickAt = nowMs
			if (
				config.strategy === 'wheel' &&
				config.momentum.enabled &&
				Math.abs(velocity) > config.momentum.minVelocity
			) {
				isFlinging = true
			}
		},

		tick(nowMs: number, cellHeight: number, cell: ScrollCell): ScrollTickResult | null {
			if (isFlinging) {
				const dt = Math.max(1, nowMs - lastTickAt)
				pendingPx += velocity * dt
				velocity *= config.momentum.friction ** (dt / 16.7)
				if (Math.abs(velocity) <= config.momentum.minVelocity) {
					stopFling()
				}
			}

			lastTickAt = nowMs

			const redeemed = redeemPending(pendingPx, cellHeight, config, cell)
			pendingPx = redeemed.pendingPx
			if (redeemed.data === null) {
				return null
			}
			return { data: redeemed.data }
		},
	}
}

interface ScrollLayoutCache {
	cellHeight: number
	cell: ScrollCell
	lockThresholdPx: number
}

function measureScrollLayout(
	screen: HTMLElement,
	term: XTerminal,
	touch: Touch,
): ScrollLayoutCache {
	const rect = screen.getBoundingClientRect()
	const { rows } = terminalGrid(rect, term)
	const cellHeight = rect.height / Math.max(1, rows)
	return {
		cellHeight,
		cell: touchToCell(touch, screen, term),
		lockThresholdPx: cellHeight,
	}
}

/** Attach single-finger vertical scroll to the xterm screen */
export function attachScrollGesture(
	term: XTerminal,
	config: ScrollConfig,
	lock: GestureLock,
	isDrawerOpen: () => boolean,
): void {
	const engine = createScrollEngine(config)
	let screenEl: HTMLElement | null = null
	let layout: ScrollLayoutCache | null = null
	let layoutValid = false
	let rafId: number | null = null
	let startY = 0
	let lastY = 0

	function invalidateLayout(): void {
		layoutValid = false
	}

	function refreshLayout(touch: Touch): void {
		const screen = screenEl
		if (!screen) return
		layout = measureScrollLayout(screen, term, touch)
		layoutValid = true
	}

	function stopRaf(): void {
		if (rafId !== null) {
			cancelAnimationFrame(rafId)
			rafId = null
		}
	}

	function scheduleRaf(): void {
		if (rafId !== null) return
		rafId = requestAnimationFrame(onFrame)
	}

	function onFrame(now: number): void {
		rafId = null
		const cached = layout
		if (!cached) {
			if (engine.isAnimationActive(0)) scheduleRaf()
			return
		}

		const result = engine.tick(now, cached.cellHeight, cached.cell)
		if (result) {
			sendData(term, result.data)
		}

		if (engine.isAnimationActive(cached.cellHeight)) {
			scheduleRaf()
		}
	}

	function onTouchStart(e: Event): void {
		if (!(e instanceof TouchEvent)) return
		if (e.touches.length !== 1) return
		const t = e.touches[0]
		if (!t) return

		engine.onTouchStart(e.timeStamp)
		startY = t.clientY
		lastY = t.clientY
		refreshLayout(t)
		if (engine.isAnimationActive(layout.cellHeight)) scheduleRaf()
	}

	function onTouchMove(e: Event): void {
		if (!(e instanceof TouchEvent)) return
		if (e.touches.length !== 1 || isDrawerOpen()) return
		const t = e.touches[0]
		if (!t) return

		const y = t.clientY
		const totalDy = y - startY
		const threshold = layout?.lockThresholdPx ?? 40

		if (lock.current === 'none' && Math.abs(totalDy) > threshold) {
			if (!tryLock(lock, 'scroll')) return
		}

		if (lock.current !== 'scroll') return

		e.preventDefault()

		engine.onTouchMove(e.timeStamp, y - lastY)
		lastY = y

		scheduleRaf()
	}

	function onTouchEnd(e: Event): void {
		if (!(e instanceof TouchEvent)) return
		if (lock.current === 'scroll') {
			engine.onTouchEnd(e.timeStamp)
			scheduleRaf()
			resetLock(lock)
		}
	}

	function attach(): void {
		const screen = document.querySelector('.xterm-screen')
		if (!(screen instanceof HTMLElement)) {
			setTimeout(attach, 200)
			return
		}

		screenEl = screen
		screen.addEventListener('touchstart', onTouchStart, { passive: true })
		screen.addEventListener('touchmove', onTouchMove, { passive: false })
		screen.addEventListener('touchend', onTouchEnd, { passive: true })
		screen.addEventListener('touchcancel', onTouchEnd, { passive: true })
		window.addEventListener('resize', invalidateLayout)
		window.visualViewport?.addEventListener('resize', invalidateLayout)
	}

	attach()
}
