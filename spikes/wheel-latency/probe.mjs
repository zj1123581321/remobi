// Wheel latency + redraw saturation probe for herdr. See README.md.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const nowMs = () => Date.now()
import { ARTIFACTS_DIR, HerdrCapture, startCleanSession, teardown } from './lib.mjs'

const PANE = 'w1:p1'
// SGR wheel-up at cell (40, 12) — matches task card and scroll.ts scrollSeq('up', 40, 12).
const WHEEL_UP = '\x1b[<64;40;12M'
const FREQS_HZ = [120, 60, 40, 30, 20, 15, 10]
const BURST_SEC = 3
const SINGLE_GAP_MS = 350
const SINGLE_N = 55

function percentile(sorted, p) {
	if (sorted.length === 0) return 0
	const idx = Math.ceil((p / 100) * sorted.length) - 1
	return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]
}

function stats(sorted) {
	const n = sorted.length
	if (n === 0) return { n: 0, p50: 0, p90: 0, p99: 0, max: 0, mean: 0 }
	const sum = sorted.reduce((a, b) => a + b, 0)
	return {
		n,
		p50: percentile(sorted, 50),
		p90: percentile(sorted, 90),
		p99: percentile(sorted, 99),
		max: sorted[n - 1],
		mean: sum / n,
	}
}

function intervalStats(events, t0, t1) {
	const ts = events.filter((e) => e.t >= t0 && e.t <= t1).map((e) => e.t)
	if (ts.length < 2) {
		return { count: ts.length, meanMs: 0, stdMs: 0, intervals: [] }
	}
	const intervals = []
	for (let i = 1; i < ts.length; i++) intervals.push(ts[i] - ts[i - 1])
	const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length
	const variance = intervals.reduce((a, v) => a + (v - mean) ** 2, 0) / intervals.length
	return { count: ts.length, meanMs: mean, stdMs: Math.sqrt(variance), intervals }
}

function eventIndexAfter(events, t) {
	for (let i = events.length - 1; i >= 0; i--) {
		if (events[i].t <= t) return i
	}
	return -1
}

function countDataEvents(events, fromIdx) {
	let n = 0
	for (let i = fromIdx + 1; i < events.length; i++) {
		if (events[i].type === 'data') n++
	}
	return n
}

function bytesFromEvents(events, fromIdx) {
	let b = 0
	for (let i = fromIdx + 1; i < events.length; i++) {
		if (events[i].type === 'data') b += events[i].bytes
	}
	return b
}

function byteSizes(events, t0, t1) {
	return events.filter((e) => e.type === 'data' && e.t >= t0 && e.t <= t1).map((e) => e.bytes)
}

async function prepareScrollablePane(cap) {
	await cap.runInPane(PANE, 'seq 1 500', 'SEQ-DONE')
	await sleep(800)
}

async function verifyWheelProducesOutput(cap) {
	const before = cap.events.length
	const t0 = nowMs()
	cap.write(WHEEL_UP)
	await cap.waitFor(() => cap.events.length > before, {
		timeoutMs: 2000,
		intervalMs: 10,
		what: 'wheel output',
	})
	const dt = nowMs() - t0
	const newEvents = cap.events.length - before
	console.log(`[verify] wheel produced ${newEvents} PTY chunk(s) in ${dt.toFixed(1)}ms`)
	return { ok: newEvents > 0, newEvents, latencyMs: dt }
}

async function measureSingleLatency(cap) {
	const latencies = []
	for (let i = 0; i < SINGLE_N; i++) {
		const idxBefore = cap.events.length
		const tSend = nowMs()
		cap.write(WHEEL_UP)
		let got = false
		const deadline = tSend + 500
		while (nowMs() < deadline) {
			if (cap.events.length > idxBefore) {
				const first = cap.events[idxBefore]
				latencies.push(first.t - tSend)
				got = true
				break
			}
			await sleep(1)
		}
		if (!got) latencies.push(500)
		await sleep(SINGLE_GAP_MS)
	}
	return stats(latencies.sort((a, b) => a - b))
}

async function measureFrequency(cap, hz) {
	const intervalMs = 1000 / hz
	const idxStart = cap.events.length
	const tStart = nowMs()
	const tEndTarget = tStart + BURST_SEC * 1000
	let sends = 0
	let nextAt = tStart
	while (nowMs() < tEndTarget) {
		const t = nowMs()
		if (t >= nextAt) {
			cap.write(WHEEL_UP)
			sends++
			nextAt += intervalMs
		}
		await sleep(0)
	}
	const tEnd = nowMs()
	const durationSec = (tEnd - tStart) / 1000
	await sleep(200)

	const burstEvents = cap.events.slice(idxStart).filter((e) => e.type === 'data')
	const inWindow = burstEvents.filter((e) => e.t >= tStart && e.t <= tEnd + 50)
	const outputCount = inWindow.length
	const totalBytes = inWindow.reduce((a, e) => a + e.bytes, 0)
	const { meanMs, stdMs, count } = intervalStats(inWindow, tStart, tEnd + 50)
	const sizes = inWindow.map((e) => e.bytes).sort((a, b) => a - b)

	return {
		targetHz: hz,
		durationSec,
		sendsPlanned: Math.floor(BURST_SEC * hz),
		sendsActual: sends,
		outputEvents: outputCount,
		effectiveRedrawHz: outputCount / durationSec,
		sendToOutputRatio: outputCount / sends,
		totalBytes,
		intervalMeanMs: meanMs,
		intervalStdMs: stdMs,
		intervalSampleCount: count,
		bytesPerEvent: stats(sizes),
	}
}

function findSaturation(freqResults) {
	const byEff = [...freqResults].sort((a, b) => b.effectiveRedrawHz - a.effectiveRedrawHz)
	const peak = byEff[0]
	// First target where effective Hz stops growing (>2 Hz gain vs next lower tier).
	const sorted = [...freqResults].sort((a, b) => a.targetHz - b.targetHz)
	let knee = sorted[0]
	for (let i = 1; i < sorted.length; i++) {
		const gain = sorted[i].effectiveRedrawHz - sorted[i - 1].effectiveRedrawHz
		if (gain > 2) knee = sorted[i]
		else break
	}
	const aboveKnee = freqResults.filter((r) => r.targetHz > knee.targetHz)
	return {
		peakEffectiveHz: peak.effectiveRedrawHz,
		peakAtTargetHz: peak.targetHz,
		kneeTargetHz: knee.targetHz,
		kneeEffectiveHz: knee.effectiveRedrawHz,
		saturatedTargets: aboveKnee.map((r) => r.targetHz),
		excessSendRatio: Object.fromEntries(
			aboveKnee.map((r) => [r.targetHz, 1 - r.sendToOutputRatio]),
		),
	}
}

async function runProbe() {
	const cap = await startCleanSession()
	const result = {
		env: {},
		verify: null,
		metric1: null,
		metric2: [],
		saturation: null,
		ts: new Date().toISOString(),
	}

	try {
		result.env = {
			herdr: (await import('node:child_process'))
				.execFileSync('herdr', ['--version'], {
					encoding: 'utf8',
				})
				.trim(),
			session: 'spike-wheel',
			cols: cap.cols,
			rows: cap.rows,
			node: process.version,
		}

		await prepareScrollablePane(cap)
		result.verify = await verifyWheelProducesOutput(cap)
		if (!result.verify.ok) throw new Error('wheel did not produce PTY output — aborting')

		// Quiet baseline before metric 1
		await sleep(500)
		const m1Start = cap.events.length
		result.metric1 = await measureSingleLatency(cap)
		result.metric1.sampleSize = SINGLE_N
		console.log(
			`[metric1] n=${result.metric1.n} p50=${result.metric1.p50.toFixed(1)} p90=${result.metric1.p90.toFixed(1)} p99=${result.metric1.p99.toFixed(1)} max=${result.metric1.max.toFixed(1)}`,
		)

		// Metric 2+3: frequency sweep (longer gap between bursts)
		for (const hz of FREQS_HZ) {
			await sleep(800)
			const row = await measureFrequency(cap, hz)
			result.metric2.push(row)
			console.log(
				`[metric2] ${hz}Hz → send=${row.sendsActual} out=${row.outputEvents} eff=${row.effectiveRedrawHz.toFixed(1)}Hz interval μ=${row.intervalMeanMs.toFixed(1)} σ=${row.intervalStdMs.toFixed(1)}`,
			)
		}

		result.saturation = findSaturation(result.metric2)

		// Recommend: among non-saturated tiers (≤ knee), pick lowest interval σ;
		// tie-break toward higher effective redraw.
		const knee = result.saturation.kneeTargetHz
		const candidates = result.metric2.filter((r) => r.targetHz <= knee)
		const smoothest = [...candidates].sort(
			(a, b) => a.intervalStdMs - b.intervalStdMs || b.effectiveRedrawHz - a.effectiveRedrawHz,
		)[0]
		result.recommendation = {
			recommendedHz: smoothest.targetHz,
			reason: `lowest output-interval σ (${smoothest.intervalStdMs.toFixed(1)} ms) at or below saturation knee (${knee} Hz send)`,
			intervalStdMs: smoothest.intervalStdMs,
			effectiveRedrawHz: smoothest.effectiveRedrawHz,
			kneeTargetHz: knee,
		}

		mkdirSync(ARTIFACTS_DIR, { recursive: true })
		const artifactPath = join(ARTIFACTS_DIR, 'wheel-latency.json')
		writeFileSync(artifactPath, JSON.stringify(result))
		console.log(`artifact: ${artifactPath}`)
		return result
	} finally {
		await teardown(cap)
	}
}

const cmd = process.argv[2]
if (cmd === 'run') {
	const data = await runProbe()
	process.exit(data.verify?.ok ? 0 : 1)
} else if (cmd === 'clean') {
	const { stopSession } = await import('./lib.mjs')
	await stopSession()
	console.log('session cleaned')
} else {
	console.error('usage: node probe.mjs <run|clean>')
	process.exit(2)
}
