/**
 * SAUC bigmodel 浏览器直连 spike。
 *
 * 用法：
 *   node_modules/.bin/tsx --no-cache spikes/asr/probe-auth.ts [mode...]
 *   mode: query-seedasr-duration | query-seedasr-concurrent | query-bigasr-duration |
 *         header-seedasr-duration | header-seedasr-concurrent | header-bigasr-duration |
 *         legacy-query-bigasr-duration | end-variant | opus | protocol-error |
 *         business-error | all
 *
 * 密钥只从 X_API_KEY 或主仓 spikes/asr/.env.local 读取。所有输出物只写 origin、
 * query 参数名、帧索引和摘要，不写密钥或完整带参 URL。
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'
import WebSocket from 'ws'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..')
const FIXTURE_ROOT = join(REPO_ROOT, 'tests', 'fixtures', 'asr')
const ORIGIN = 'wss://openspeech.bytedance.com'
const ASYNC_ENDPOINT = `${ORIGIN}/api/v3/sauc/bigmodel_async`
const LEGACY_ENDPOINT = `${ORIGIN}/api/v3/sauc/bigmodel`
const MAIN_ENV = '/home/zlx/projects/oss/remobi/spikes/asr/.env.local'
const RESOURCE_IDS = {
	seedasrDuration: 'volc.seedasr.sauc.duration',
	seedasrConcurrent: 'volc.seedasr.sauc.concurrent',
	bigasrDuration: 'volc.bigasr.sauc.duration',
} as const
const PCM_RATE = 16_000
const PCM_CHUNK_BYTES = 3_200

const MESSAGE = {
	clientFull: 0b0001,
	clientAudio: 0b0010,
	serverFull: 0b1001,
	serverAck: 0b1011,
	serverError: 0b1111,
} as const

const FLAGS = {
	none: 0b0000,
	positiveSequence: 0b0001,
	negativeWithoutSequence: 0b0010,
	negativeWithSequence: 0b0011,
} as const

type EndVariant = 'neg-no-seq' | 'neg-with-seq'
type AudioFormat = 'pcm' | 'opus'
type Fault = 'none' | 'protocol' | 'business'
type AuthMode = 'query' | 'header'

interface Candidate {
	mode: string
	endpoint: string
	resourceId: string
	authMode: AuthMode
}

interface Keys {
	apiKey: string
}

interface ProbeOptions {
	mode: string
	url: string
	queryNames: string[]
	headers?: Record<string, string>
	endpoint: string
	resourceId: string
	authMode: AuthMode
	audioFormat: AudioFormat
	endVariant: EndVariant
	fault: Fault
}

interface DecodedFrame {
	version: number
	headerSizeWords: number
	messageType: number
	flags: number
	serialization: number
	compression: number
	sequence?: number
	errorCode?: number
	payloadSize: number
	payloadOffset: number
	payload: Buffer
}

interface FixtureRun {
	mode: string
	directory: string
	nextId: number
	transcript: string[]
}

interface ProbeResult {
	handshake: 'ok' | 'fail'
	detail: string
	mode: string
	directory: string
	target?: { endpoint: string; resourceId: string; authMode: AuthMode }
}

function loadKeys(): Keys {
	let apiKey = process.env.X_API_KEY ?? ''
	if (!apiKey && existsSync(MAIN_ENV)) {
		const lines = readFileSync(MAIN_ENV, 'utf8').split(/\r?\n/)
		for (const line of lines) {
			const match = line.match(/^\s*X_API_KEY\s*=\s*(.*?)\s*$/)
			if (!match) continue
			apiKey = match[1]
		}
	}
	if (!apiKey) {
		throw new Error('缺少 X_API_KEY（环境变量或主仓 spikes/asr/.env.local）')
	}
	return { apiKey }
}

function binary(value: number): string {
	return `0b${value.toString(2).padStart(4, '0')}`
}

function encodeFrame(
	messageType: number,
	flags: number,
	payload: Buffer,
	options: { sequence?: number; gzip?: boolean } = {},
): Buffer {
	const body = options.gzip ? gzipSync(payload) : payload
	const header = Buffer.from([
		(0b0001 << 4) | 0b0001,
		(messageType << 4) | flags,
		(0b0001 << 4) | (options.gzip ? 0b0001 : 0b0000),
		0,
	])
	const parts: Buffer[] = [header]
	if (options.sequence !== undefined) {
		const sequence = Buffer.alloc(4)
		sequence.writeInt32BE(options.sequence)
		parts.push(sequence)
	}
	const size = Buffer.alloc(4)
	size.writeUInt32BE(body.length)
	parts.push(size, body)
	return Buffer.concat(parts)
}

function decodeFrame(frame: Buffer): DecodedFrame {
	if (frame.length < 4) throw new Error(`帧短于 4 字节: ${frame.length}`)
	const version = frame[0] >> 4
	const headerSizeWords = frame[0] & 0x0f
	const messageType = frame[1] >> 4
	const flags = frame[1] & 0x0f
	const serialization = frame[2] >> 4
	const compression = frame[2] & 0x0f
	let offset = headerSizeWords * 4
	let sequence: number | undefined
	let errorCode: number | undefined
	if (frame.length < offset + 4) throw new Error('帧缺少描述字段')
	if (messageType === MESSAGE.serverError) {
		errorCode = frame.readUInt32BE(offset)
		offset += 4
	}
	if (flags === FLAGS.positiveSequence || flags === FLAGS.negativeWithSequence) {
		if (frame.length < offset + 4) throw new Error('帧缺少序列号')
		sequence = frame.readInt32BE(offset)
		offset += 4
	}
	if (frame.length < offset + 4) throw new Error('帧缺少 payload 长度')
	const payloadSize = frame.readUInt32BE(offset)
	offset += 4
	if (frame.length !== offset + payloadSize) {
		throw new Error(`payload 长度不匹配: field=${payloadSize}, actual=${frame.length - offset}`)
	}
	let payload = frame.subarray(offset)
	if (compression === 0b0001 && payload.length > 0) payload = gunzipSync(payload)
	return {
		version,
		headerSizeWords,
		messageType,
		flags,
		serialization,
		compression,
		sequence,
		errorCode,
		payloadSize,
		payloadOffset: offset,
		payload,
	}
}

function payloadSummary(payload: Buffer): Record<string, unknown> {
	const digest = createHash('sha256').update(payload).digest('hex').slice(0, 16)
	const summary: Record<string, unknown> = { sha256_16: digest, bytes: payload.length }
	if (!payload.length) return summary
	try {
		const value: unknown = JSON.parse(payload.toString('utf8'))
		if (typeof value !== 'object' || value === null) return summary
		const record = value as Record<string, unknown>
		const result =
			typeof record.result === 'object' && record.result !== null
				? (record.result as Record<string, unknown>)
				: undefined
		const selected: Record<string, unknown> = {}
		for (const key of ['code', 'message', 'is_final', 'definite', 'sequence']) {
			if (key in record) selected[key] = record[key]
		}
		if (result) {
			for (const key of ['text', 'is_final', 'definite']) {
				if (key in result) selected[`result.${key}`] = result[key]
			}
		}
		if (Object.keys(selected).length) summary.json = selected
	} catch {
		// 音频帧不是 JSON；摘要只保留哈希，不落原始响应体。
	}
	return summary
}

function createRun(mode: string): FixtureRun {
	const stamp = new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z')
	const directory = join(FIXTURE_ROOT, `${stamp}-${mode}-${randomUUID().slice(0, 8)}`)
	mkdirSync(directory, { recursive: true })
	return { mode, directory, nextId: 0, transcript: [] }
}

function recordFrame(
	run: FixtureRun,
	direction: 'send' | 'recv',
	label: string,
	frame: Buffer,
): DecodedFrame | undefined {
	const id = String(run.nextId++).padStart(3, '0')
	const file = `${id}-${direction}-${label}.hex`
	writeFileSync(join(run.directory, file), `${frame.toString('hex')}\n`)
	let decoded: DecodedFrame | undefined
	let decodeError: string | undefined
	try {
		decoded = decodeFrame(frame)
	} catch (error) {
		decodeError = error instanceof Error ? error.message : String(error)
	}
	const entry: Record<string, unknown> = {
		id,
		direction,
		label,
		file,
		bytes: frame.length,
		headerHex: frame.subarray(0, 4).toString('hex'),
	}
	if (decoded) {
		entry.header = {
			version: binary(decoded.version),
			headerSizeWords: decoded.headerSizeWords,
			messageType: binary(decoded.messageType),
			flags: binary(decoded.flags),
			serialization: binary(decoded.serialization),
			compression: binary(decoded.compression),
		}
		entry.payloadOffset = decoded.payloadOffset
		entry.payloadSize = decoded.payloadSize
		if (decoded.sequence !== undefined) entry.sequence = decoded.sequence
		if (decoded.errorCode !== undefined) entry.errorCode = decoded.errorCode
		entry.payload = payloadSummary(decoded.payload)
	} else {
		entry.decodeError = decodeError
	}
	run.transcript.push(JSON.stringify(entry))
	const header = decoded
		? `type=${binary(decoded.messageType)} flags=${binary(decoded.flags)} offset=${decoded.payloadOffset}`
		: `decode-error=${decodeError}`
	console.log(`  [${id}] ${direction} ${label} ${frame.length}B ${header}`)
	if (decoded?.messageType === MESSAGE.serverError) {
		console.log(
			`       protocol-error code=${decoded.errorCode ?? 'unknown'} payload=${decoded.payloadSize}B`,
		)
	}
	if (decoded?.messageType === MESSAGE.serverFull) {
		const summary = payloadSummary(decoded.payload)
		const result = summary.json as Record<string, unknown> | undefined
		if (result?.['result.text'] !== undefined)
			console.log(`       result.text=${String(result['result.text']).slice(0, 120)}`)
	}
	return decoded
}

function closeRun(run: FixtureRun, result: Record<string, unknown>): void {
	writeFileSync(join(run.directory, 'transcript.jsonl'), `${run.transcript.join('\n')}\n`)
	writeFileSync(
		join(run.directory, 'meta.json'),
		`${JSON.stringify(
			{
				mode: run.mode,
				at: new Date().toISOString(),
				...result,
			},
			null,
			2,
		)}\n`,
	)
	console.log(`  fixture → ${run.directory}`)
}

function sinePcm(seconds: number): Buffer {
	const samples = Math.floor(PCM_RATE * seconds)
	const pcm = Buffer.alloc(samples * 2)
	for (let index = 0; index < samples; index += 1) {
		const value = Math.round(Math.sin((2 * Math.PI * 440 * index) / PCM_RATE) * 12_000)
		pcm.writeInt16LE(value, index * 2)
	}
	return pcm
}

function buildRequest(audioFormat: AudioFormat, fault: Fault): Record<string, unknown> {
	return {
		user: { uid: `remobi-spike-${randomUUID().slice(0, 8)}` },
		audio: {
			format: fault === 'business' ? 'not-a-real-format' : audioFormat,
			rate: PCM_RATE,
			bits: 16,
			channel: 1,
		},
		request: {
			model_name: fault === 'business' ? 'unsupported-spike-model' : 'bigmodel',
			show_utterances: true,
			enable_punc: true,
		},
	}
}

function queryNames(url: string): string[] {
	const query = url.split('?')[1] ?? ''
	return query ? query.split('&').map((part) => part.split('=')[0]) : []
}

function sendAudio(
	run: FixtureRun,
	socket: WebSocket,
	audioFormat: AudioFormat,
	endVariant: EndVariant,
): void {
	const pcm = audioFormat === 'pcm' ? sinePcm(1) : Buffer.alloc(320)
	let sequence = 0
	for (let offset = 0; offset < pcm.length; offset += PCM_CHUNK_BYTES) {
		sequence += 1
		const chunk = pcm.subarray(offset, offset + PCM_CHUNK_BYTES)
		const frame = encodeFrame(MESSAGE.clientAudio, FLAGS.none, chunk)
		recordFrame(run, 'send', `audio-${sequence}`, frame)
		socket.send(frame)
	}
	const endFrame =
		endVariant === 'neg-with-seq'
			? encodeFrame(MESSAGE.clientAudio, FLAGS.negativeWithSequence, Buffer.alloc(0), {
					sequence: -(sequence + 2),
				})
			: encodeFrame(MESSAGE.clientAudio, FLAGS.negativeWithoutSequence, Buffer.alloc(0))
	recordFrame(run, 'send', `end-${endVariant}`, endFrame)
	socket.send(endFrame)
}

function responseLabel(frame: DecodedFrame): string {
	if (frame.messageType === MESSAGE.serverError) return 'protocol-error'
	if (frame.messageType !== MESSAGE.serverFull) return 'server-frame'
	return frame.flags === FLAGS.negativeWithSequence ? 'server-final' : 'server-partial'
}

function isFinalResponse(
	frame: DecodedFrame,
	summary: Record<string, unknown> | undefined,
): boolean {
	return (
		frame.flags === FLAGS.negativeWithSequence ||
		summary?.['result.is_final'] === true ||
		summary?.['result.definite'] === true
	)
}

async function runProbe(options: ProbeOptions): Promise<ProbeResult> {
	const run = createRun(options.mode)
	console.log(
		`\n=== mode=${options.mode} end=${options.endVariant} audio=${options.audioFormat} fault=${options.fault} ===`,
	)
	console.log(
		`  target: ${options.endpoint} resource=${options.resourceId} auth=${options.authMode} (query 参数名: ${options.queryNames.join(',') || 'none'})`,
	)
	return await new Promise<ProbeResult>((resolve) => {
		let settled = false
		let sawFinal = false
		const socket = new WebSocket(options.url, {
			headers: options.headers,
			handshakeTimeout: 10_000,
		})
		socket.binaryType = 'nodebuffer'
		const timer = setTimeout(() => finish('fail', '整体超时 30s'), 30_000)
		const finish = (
			handshake: 'ok' | 'fail',
			detail: string,
			extra: Record<string, unknown> = {},
		): void => {
			if (settled) return
			settled = true
			if (timer) clearTimeout(timer)
			if (socket && socket.readyState < WebSocket.CLOSING) socket.close()
			const target = {
				endpoint: options.endpoint,
				resourceId: options.resourceId,
				authMode: options.authMode,
			}
			closeRun(run, { handshake, detail, target, ...extra })
			console.log(`  => ${handshake.toUpperCase()}: ${detail}`)
			resolve({ handshake, detail, mode: options.mode, directory: run.directory, target })
		}
		const sendFullRequest = (): void => {
			if (!socket) throw new Error('WS 尚未创建')
			const payload = Buffer.from(JSON.stringify(buildRequest(options.audioFormat, options.fault)))
			const frame = encodeFrame(MESSAGE.clientFull, FLAGS.none, payload)
			recordFrame(run, 'send', 'full-client-request', frame)
			socket.send(frame)
		}
		const openSession = async (): Promise<void> => {
			sendFullRequest()
			if (options.fault === 'protocol') {
				const malformed = Buffer.from([0x11, 0x20, 0x10, 0x00])
				recordFrame(run, 'send', 'malformed-protocol-frame', malformed)
				socket.send(malformed)
				return
			}
			if (options.fault === 'business') return
			sendAudio(run, socket as WebSocket, options.audioFormat, options.endVariant)
		}

		socket.on('unexpected-response', (_request, response) => {
			const logid = response.headers['x-tt-logid']
			finish(
				'fail',
				`握手拒绝 HTTP ${response.statusCode} ${response.statusMessage ?? ''}${logid ? ` X-Tt-Logid=${logid}` : ''}`,
				{ httpStatus: response.statusCode, logid: logid ?? null },
			)
		})
		socket.on('error', (error) => finish('fail', `WS error: ${error.message}`))
		socket.on('open', () => {
			console.log('  握手成功（HTTP 101）')
			void openSession().catch((error: unknown) => {
				finish('ok', `发送阶段异常: ${error instanceof Error ? error.message : String(error)}`)
			})
		})
		socket.on('message', (data) => {
			const frame = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
			const decodedFrame = decodeFrame(frame)
			const decoded = recordFrame(run, 'recv', responseLabel(decodedFrame), frame)
			if (!decoded) return
			if (decoded.messageType === MESSAGE.serverError) {
				finish('ok', `收到协议错误帧 0xF code=${decoded.errorCode ?? 'unknown'}`)
				return
			}
			if (decoded.messageType === MESSAGE.serverFull) {
				const summary = payloadSummary(decoded.payload).json as Record<string, unknown> | undefined
				const final = isFinalResponse(decoded, summary)
				const businessCode = summary?.code
				if (businessCode !== undefined && businessCode !== 0 && businessCode !== '0') {
					finish('ok', `收到业务错误响应帧 0x9 code=${String(businessCode)}`)
					return
				}
				if (final) {
					sawFinal = true
					finish('ok', '收到 final 响应')
				}
			}
		})
		socket.on('close', (code, reason) => {
			finish(
				sawFinal || socket?.readyState === WebSocket.OPEN ? 'ok' : 'fail',
				`WS close code=${code} reason=${reason.toString().slice(0, 120)}`,
				{ closeCode: code },
			)
		})
	})
}

const CANDIDATES: readonly Candidate[] = [
	{
		mode: 'query-seedasr-duration',
		endpoint: ASYNC_ENDPOINT,
		resourceId: RESOURCE_IDS.seedasrDuration,
		authMode: 'query',
	},
	{
		mode: 'query-seedasr-concurrent',
		endpoint: ASYNC_ENDPOINT,
		resourceId: RESOURCE_IDS.seedasrConcurrent,
		authMode: 'query',
	},
	{
		mode: 'query-bigasr-duration',
		endpoint: ASYNC_ENDPOINT,
		resourceId: RESOURCE_IDS.bigasrDuration,
		authMode: 'query',
	},
	{
		mode: 'header-seedasr-duration',
		endpoint: ASYNC_ENDPOINT,
		resourceId: RESOURCE_IDS.seedasrDuration,
		authMode: 'header',
	},
	{
		mode: 'header-seedasr-concurrent',
		endpoint: ASYNC_ENDPOINT,
		resourceId: RESOURCE_IDS.seedasrConcurrent,
		authMode: 'header',
	},
	{
		mode: 'header-bigasr-duration',
		endpoint: ASYNC_ENDPOINT,
		resourceId: RESOURCE_IDS.bigasrDuration,
		authMode: 'header',
	},
	{
		mode: 'legacy-query-bigasr-duration',
		endpoint: LEGACY_ENDPOINT,
		resourceId: RESOURCE_IDS.bigasrDuration,
		authMode: 'query',
	},
]

function makeQuery(apiKey: string, candidate: Candidate): { url: string; queryNames: string[] } {
	const url = `${candidate.endpoint}?api_key=${encodeURIComponent(apiKey)}&api_resource_id=${encodeURIComponent(candidate.resourceId)}`
	return { url, queryNames: queryNames(url) }
}

function optionsFor(
	candidate: Candidate,
	apiKey: string,
	mode = candidate.mode,
	audioFormat: AudioFormat = 'pcm',
	endVariant: EndVariant = 'neg-with-seq',
	fault: Fault = 'none',
): ProbeOptions {
	const query = candidate.authMode === 'query' ? makeQuery(apiKey, candidate) : undefined
	return {
		mode,
		url: query?.url ?? candidate.endpoint,
		queryNames: query?.queryNames ?? [],
		headers:
			candidate.authMode === 'header'
				? { 'X-Api-Key': apiKey, 'X-Api-Resource-Id': candidate.resourceId }
				: undefined,
		endpoint: candidate.endpoint,
		resourceId: candidate.resourceId,
		authMode: candidate.authMode,
		audioFormat,
		endVariant,
		fault,
	}
}

async function main(): Promise<void> {
	const requested = process.argv.slice(2)
	const runAll = requested.length === 0 || requested.includes('all')
	const keys = loadKeys()
	const { results } = await runAuthCandidates(keys, requested, runAll)

	console.log('\n===== 汇总（不含密钥与完整带参 URL） =====')
	for (const result of results)
		console.log(`${result.handshake === 'ok' ? '✅' : '❌'} ${result.mode}: ${result.detail}`)
	if (!results.some((result) => result.target?.authMode === 'query' && result.handshake === 'ok')) {
		console.log(
			'结论：query 鉴权未成功，直连 no-go；请结合 header 对照组区分 key 问题与 query 鉴权支持问题。',
		)
	}
}

async function runAuthCandidates(
	keys: Keys,
	requested: string[],
	runAll: boolean,
): Promise<{ results: ProbeResult[] }> {
	const results: ProbeResult[] = []
	let followupCandidate: Candidate | undefined
	let querySuccess: Candidate | undefined
	const run = async (
		candidate: Candidate,
		mode = candidate.mode,
		audioFormat: AudioFormat = 'pcm',
		endVariant: EndVariant = 'neg-with-seq',
		fault: Fault = 'none',
	): Promise<ProbeResult> => {
		const result = await runProbe(
			optionsFor(candidate, keys.apiKey, mode, audioFormat, endVariant, fault),
		)
		results.push(result)
		return result
	}

	for (const candidate of CANDIDATES) {
		if (!runAll && !requested.includes(candidate.mode)) continue
		const result = await run(candidate)
		if (result.handshake === 'ok' && !followupCandidate) followupCandidate = candidate
		if (result.handshake === 'ok' && candidate.authMode === 'query' && !querySuccess)
			querySuccess = candidate
	}
	const target = querySuccess ?? followupCandidate
	const followups: [boolean, string, AudioFormat, EndVariant, Fault][] = [
		[
			runAll || requested.includes('end-variant'),
			'end-variant-neg-no-seq',
			'pcm',
			'neg-no-seq',
			'none',
		],
		[runAll || requested.includes('opus'), 'opus', 'opus', 'neg-with-seq', 'none'],
		[
			runAll || requested.includes('protocol-error'),
			'protocol-error',
			'pcm',
			'neg-with-seq',
			'protocol',
		],
		[
			runAll || requested.includes('business-error'),
			'business-error',
			'pcm',
			'neg-with-seq',
			'business',
		],
	]
	for (const [enabled, mode, audioFormat, endVariant, fault] of followups) {
		if (target && enabled)
			await run(target, `${target.mode}-${mode}`, audioFormat, endVariant, fault)
	}
	return { results }
}

main().catch((error: unknown) => {
	console.error(`FATAL: ${error instanceof Error ? error.message : String(error)}`)
	process.exitCode = 2
})
