// Scenario runner for the scrollback spike. Each subcommand starts an
// isolated herdr session (never the user's), drives it, replays the capture,
// and writes an evidence artifact. See README.md for usage.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import {
	ARTIFACTS_DIR,
	altScreenUsage,
	analyzeScroll,
	calibrateRegion,
	herdrCli,
	learnGuards,
	replayFrames,
	sliceLine,
	startCleanSession,
	stopSession,
	teardown,
	validateNumberSequence,
} from './lib.mjs'

const PANE = 'w1:p1'
const CAL_CMD =
	'for i in $(seq 1 120); do echo cal-$i-abcdefghijklmnopqrstuvwxyz0123456789; sleep 0.06; done'

// Chrome text that must never appear in reconstructed history.
const CHROME_PATTERNS = [/spaces/, /agents.*grouped/, /[▕▐▏]/, /ms⠀/, /herdr-spikes?-scrollback/]

function chromeLeaks(history) {
	return history.filter((line) => CHROME_PATTERNS.some((p) => p.test(line)))
}

function writeArtifact(name, data) {
	mkdirSync(ARTIFACTS_DIR, { recursive: true })
	const path = join(ARTIFACTS_DIR, `${name}.json`)
	// Minified — artifacts are machine output regenerable via README commands.
	writeFileSync(path, JSON.stringify(data))
	console.log(`artifact: ${path}`)
}

async function calibrate(cap) {
	cap.mark('cal:start')
	await cap.runInPane(PANE, CAL_CMD, 'CAL-DONE')
	const calEnd = cap.mark('cal:end')
	const frames = await replayFrames(cap.events)
	const calFrames = frames.filter((f) => f.eventIndex < calEnd && f.kind === 'data')
	const region = calibrateRegion(calFrames, { minK: 4 })
	const guards = learnGuards(calFrames, region.region)
	console.log(
		`calibrated region r${region.region.r0}..r${region.region.r1} c${region.region.c0}..c${region.region.c1} from ${region.pairs} pairs guards=${JSON.stringify(guards)}`,
	)
	return { region, guards }
}

function summarize(name, analysis) {
	const { stat, shiftHist } = analysis
	const changed = stat.dataFrames
	const skipShare = changed === 0 ? 0 : (stat.skippedUnaligned + stat.skippedChrome) / changed
	console.log(
		`[${name}] scrolls=${stat.scrolls} lines=${stat.scrollLines} skipped=${stat.skippedUnaligned}+${stat.skippedChrome}/${changed} (${(skipShare * 100).toFixed(1)}%) resets=${stat.resets}`,
	)
	console.log(`[${name}] shiftHist=${JSON.stringify(shiftHist)}`)
}

// Every region-sliced row that ever appeared on screen — used to prove no
// history line was fabricated (all non-marker lines must be members).
function seenOnScreenSet(frames, region) {
	const seen = new Set()
	for (const f of frames) {
		if (f.kind !== 'data') continue
		for (let r = region.r0; r <= region.r1; r++) seen.add(sliceLine(f.lines[r] ?? '', region))
	}
	return seen
}

async function runSeq() {
	const cap = await startCleanSession()
	try {
		const { region, guards } = await calibrate(cap)
		const seqStart = cap.mark('seq5000:start')
		await cap.runInPane(PANE, 'seq 1 5000', 'SEQ-DONE')
		await sleep(1500)
		const capturePath = cap.saveCapture('seq5000')
		const frames = await replayFrames(cap.events)
		const analysis = analyzeScroll(frames, region.region, {
			minK: 4,
			fromEventIndex: seqStart,
			guards,
		})
		const validation = validateNumberSequence(analysis.history)
		const leaks = chromeLeaks(analysis.history)
		summarize('seq5000', analysis)
		console.log(
			`[seq5000] numbers=${validation.count} first=${validation.first} last=${validation.last}`,
		)
		console.log(
			`[seq5000] problems=${JSON.stringify(validation.problems)} junk=${validation.junk.length} leaks=${leaks.length}`,
		)
		writeArtifact('seq5000', {
			altScreen: altScreenUsage(cap.events),
			region: region.region,
			capturePath,
			stat: analysis.stat,
			shiftHist: analysis.shiftHist,
			validation,
			chromeLeaks: leaks.slice(0, 20),
			historyFirst: analysis.history.slice(0, 5),
			historyLast: analysis.history.slice(-5),
			verdict: {
				// The hard gate: ALL 5000 numbers, strictly ordered, nothing else.
				// count=0 must read as failure, not vacuous continuity.
				strictContinuity:
					validation.count === 5000 &&
					validation.problems.missing.length === 0 &&
					validation.problems.duplicated.length === 0 &&
					validation.problems.disordered.length === 0,
				zeroErrorInsertion: validation.junk.length === 0 && leaks.length === 0,
			},
		})
	} finally {
		await teardown(cap)
	}
}

// Granularity boundary: how much output per render frame can the diff still
// capture? Paced lines (small shifts) vs single bursts of growing size.
async function runPaced() {
	const cap = await startCleanSession()
	try {
		const { region, guards } = await calibrate(cap)
		const phases = []

		const pacedStart = cap.mark('paced:start')
		await cap.runInPane(
			PANE,
			'seq 1 2000 | while read i; do echo paced-$i-abcdefghijklmnopqrstuvwxyz; sleep 0.01; done',
			'PACED-DONE',
		)
		await sleep(1500)
		phases.push({ name: 'paced2000', start: pacedStart, end: cap.mark('paced:end'), total: 2000 })

		for (const size of [20, 60, 200]) {
			const s = cap.mark(`burst${size}:start`)
			await cap.runInPane(PANE, `seq 1 ${size}`, `BURST${size}-DONE`)
			await sleep(1200)
			phases.push({
				name: `burst${size}`,
				start: s,
				end: cap.mark(`burst${size}:end`),
				total: size,
			})
		}

		const frames = await replayFrames(cap.events)
		const capturePath = cap.saveCapture('granularity')
		const summary = {}
		for (const phase of phases) {
			const phaseFrames = frames.filter((f) => f.eventIndex < phase.end)
			const bounded = analyzeScroll(phaseFrames, region.region, {
				minK: 4,
				fromEventIndex: phase.start,
				guards,
			})
			const captured = phase.name.startsWith('paced')
				? bounded.history.filter((l) => /^[\s│]*paced-\d+-/.test(l)).length
				: bounded.history.filter((l) => /^[\s│]*\d+\s*$/.test(l)).length
			const other = bounded.history.length - captured
			summary[phase.name] = {
				captured,
				otherLines: other,
				total: phase.total,
				stat: bounded.stat,
				shiftHist: bounded.shiftHist,
			}
			console.log(
				`[granularity:${phase.name}] captured=${captured}/${phase.total} scrolls=${bounded.stat.scrolls} skipped=${bounded.stat.skippedUnaligned}+${bounded.stat.skippedChrome}`,
			)
		}
		writeArtifact('granularity', { region: region.region, capturePath, summary })
	} finally {
		await teardown(cap)
	}
}

async function markerBlock(cap, tag, lines = 15) {
	await cap.runInPane(
		PANE,
		`for i in $(seq 1 ${lines}); do echo ${tag}-$i-abcdefghijklmnopqrstuvwxyz; sleep 0.06; done`,
		`${tag}-DONE`,
	)
}

async function runInterference() {
	const cap = await startCleanSession()
	try {
		const { region, guards } = await calibrate(cap)
		const start = cap.mark('interference:start')

		await markerBlock(cap, 'M1')

		// tab switch: create a second tab (focus follows), switch back
		herdrCli(['tab', 'create'])
		await sleep(1200)
		const tabs = JSON.parse(herdrCli(['tab', 'list'])).result.tabs
		const other = tabs.find((t) => t.tab_id !== 'w1:t1')
		if (other) herdrCli(['tab', 'focus', other.tab_id])
		await sleep(1200)
		herdrCli(['tab', 'focus', 'w1:t1'])
		await sleep(1200)
		await markerBlock(cap, 'M2')

		// resize bigger, scroll, resize back
		cap.resize(100, 30)
		await sleep(1500)
		await markerBlock(cap, 'M3')
		cap.resize(80, 24)
		await sleep(1500)
		await markerBlock(cap, 'M4')

		// pane split right, scroll, close the split pane
		herdrCli(['pane', 'split', '--current', '--direction', 'right'])
		await sleep(1500)
		await markerBlock(cap, 'M5')
		const panes = JSON.parse(herdrCli(['pane', 'list'])).result.panes
		const splitPane = panes.find((p) => p.pane_id !== PANE)
		if (splitPane) herdrCli(['pane', 'close', splitPane.pane_id])
		await sleep(1500)
		await markerBlock(cap, 'M6')

		// fullscreen TUI: less, page, quit
		cap.sendText(PANE, 'less /etc/services\n')
		await sleep(2000)
		cap.sendText(PANE, ' ')
		await sleep(800)
		cap.sendText(PANE, 'q')
		await sleep(1200)
		await markerBlock(cap, 'M7')

		const frames = await replayFrames(cap.events)
		const analysis = analyzeScroll(frames, region.region, {
			minK: 4,
			fromEventIndex: start,
			guards,
		})
		const history = analysis.history
		// Zero-error check: every non-marker history line must be a verifiable
		// member of the pane screen (prompts, echoes, wrapped fragments pass).
		const seenOnScreen = seenOnScreenSet(frames, region.region)
		const junk = history.filter((l) => !/^M\d+-\d+-/.test(l))
		const unexplained = junk.filter((l) => !seenOnScreen.has(l))
		const leaks = chromeLeaks(history)
		const tags = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7']
		const perTag = Object.fromEntries(
			tags.map((t) => [t, history.filter((l) => l.startsWith(`${t}-`)).length]),
		)
		let orderOk = true
		let lastSeen = -1
		for (const line of history) {
			const m = line.match(/^(M\d)-/)
			if (!m) continue
			const idx = tags.indexOf(m[1])
			if (idx < lastSeen) orderOk = false
			lastSeen = Math.max(lastSeen, idx)
		}
		summarize('interference', analysis)
		console.log(`[interference] perTag=${JSON.stringify(perTag)} orderOk=${orderOk}`)
		console.log(
			`[interference] residue=${junk.length - unexplained.length} unexplained=${unexplained.length} leaks=${leaks.length}`,
		)
		if (unexplained.length > 0)
			console.log(`[interference] samples=${JSON.stringify(unexplained.slice(0, 8))}`)
		writeArtifact('interference', {
			region: region.region,
			stat: analysis.stat,
			perTag,
			orderOk,
			residueExplainable: junk.length - unexplained.length,
			unexplained: unexplained.slice(0, 20),
			chromeLeaks: leaks.slice(0, 20),
			verdict: {
				zeroErrorInsertion: unexplained.length === 0 && leaks.length === 0,
			},
		})
	} finally {
		await teardown(cap)
	}
}

async function runRealLoad() {
	const cap = await startCleanSession()
	try {
		const { region, guards } = await calibrate(cap)
		const start = cap.mark('realload:start')
		const beginAt = Date.now()
		let round = 0
		while (Date.now() - beginAt < 300000 && round < 400) {
			round++
			await cap.runInPane(
				PANE,
				`find / -type f 2>/dev/null | head -3000; echo load-round-${round}`,
				`LR${round}-DONE`,
				240000,
			)
		}
		await sleep(1500)
		const capturePath = cap.saveCapture('realload')
		const durationSec = (Date.now() - beginAt) / 1000
		const frames = await replayFrames(cap.events)
		const analysis = analyzeScroll(frames, region.region, {
			minK: 4,
			fromEventIndex: start,
			guards,
		})
		const leaks = chromeLeaks(analysis.history)
		const roundMarkers = analysis.history.filter((l) => /^load-round-\d+$/.test(l)).length
		// find emits 3000 lines per round (+1 marker echo), possibly wrapped.
		const expectedLines = 3001 * round
		const seenOnScreen = seenOnScreenSet(frames, region.region)
		const unexplained = analysis.history.filter((l) => !seenOnScreen.has(l))
		summarize('realload', analysis)
		console.log(
			`[realload] duration=${durationSec.toFixed(0)}s rounds=${round} markers=${roundMarkers}/${round} history=${analysis.history.length} of ~${expectedLines} unexplained=${unexplained.length} leaks=${leaks.length}`,
		)
		writeArtifact('realload', {
			region: region.region,
			durationSec,
			rounds: round,
			roundMarkersInHistory: roundMarkers,
			expectedEmittedLines: expectedLines,
			historyLines: analysis.history.length,
			capturePath,
			stat: analysis.stat,
			shiftHist: analysis.shiftHist,
			unexplained: unexplained.slice(0, 20),
			chromeLeaks: leaks.slice(0, 20),
			historyFirst: analysis.history.slice(0, 3),
			historyLast: analysis.history.slice(-3),
			verdict: {
				zeroErrorInsertion: unexplained.length === 0 && leaks.length === 0,
			},
		})
	} finally {
		await teardown(cap)
	}
}

const commands = {
	seq: runSeq,
	paced: runPaced,
	interference: runInterference,
	realload: runRealLoad,
}

const which = process.argv[2]
if (which === 'clean') {
	await stopSession()
	console.log('session cleaned')
} else if (commands[which]) {
	await commands[which]()
} else {
	console.error(`usage: node scenario.mjs <seq|paced|interference|realload|clean> (got: ${which})`)
	process.exit(2)
}
