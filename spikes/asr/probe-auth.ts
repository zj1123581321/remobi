/**
 * SAUC bigmodel 浏览器直连 spike。
 *
 * 用法：
 *   node_modules/.bin/tsx --no-cache spikes/asr/probe-auth.ts [mode...]
 *   mode: query-raw | query-jwt | header | end-variant | opus | protocol-error |
 *         business-error | all
 *
 * 密钥只从 VOLC_APP_KEY / VOLC_ACCESS_KEY 或同目录 .env.local 读取。所有输出物
 * 只写 origin、query 参数名、帧索引和摘要，不写密钥或完整带参 URL。
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
const ENDPOINT = `${ORIGIN}/api/v3/sauc/bigmodel`
const RESOURCE_ID = 'volc.bigasr.sauc.duration'
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
type ProbeMode =
	| 'query-raw'
	| 'query-jwt'
	| 'header'
	| 'end-variant-neg-no-seq'
	| 'opus'
	| 'protocol-error'
	| 'business-error'

interface Keys {
	appKey: string
	accessKey: string
}

interface ProbeOptions {
	mode: ProbeMode
	url: string
	queryNames: string[]
	headers?: Record<string, string>
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
	mode: ProbeMode
	directory: string
	nextId: number
	transcript: string[]
}

interface ProbeResult {
	handshake: 'ok' | 'fail'
	detail: string
	mode: ProbeMode
	directory: string
}

function loadKeys(): Keys {
	let appKey = process.env.VOLC_APP_KEY ?? ''
	let accessKey = process.env.VOLC_ACCESS_KEY ?? ''
	const localEnv = join(HERE, '.env.local')
	if ((!appKey || !accessKey) && existsSync(localEnv)) {
		const lines = readFileSync(localEnv, 'utf8').split(/\r?\n/)
		for (const line of lines) {
			const match = line.match(/^\s*(VOLC_APP_KEY|VOLC_ACCESS_KEY)\s*=\s*(.*?)\s*$/)
			if (!match) continue
			if (match[1] === 'VOLC_APP_KEY' && !appKey) appKey = match[2]
			if (match[1] === 'VOLC_ACCESS_KEY' && !accessKey) accessKey = match[2]
		}
	}
	if (!appKey || !accessKey) {
		throw new Error('缺少 VOLC_APP_KEY / VOLC_ACCESS_KEY（环境变量或 spikes/asr/.env.local）')
	}
	return { appKey, accessKey }
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

function createRun(mode: ProbeMode): FixtureRun {
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
					sequence: -(sequence + 1),
				})
			: encodeFrame(MESSAGE.clientAudio, FLAGS.negativeWithoutSequence, Buffer.alloc(0))
	recordFrame(run, 'send', `end-${endVariant}`, endFrame)
	socket.send(endFrame)
}

async function runProbe(options: ProbeOptions): Promise<ProbeResult> {
	const run = createRun(options.mode)
	console.log(
		`\n=== mode=${options.mode} end=${options.endVariant} audio=${options.audioFormat} fault=${options.fault} ===`,
	)
	console.log(
		`  target: ${ENDPOINT} (query 参数名: ${options.queryNames.join(',') || 'none; header 鉴权'})`,
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
			closeRun(run, { handshake, detail, ...extra })
			console.log(`  => ${handshake.toUpperCase()}: ${detail}`)
			resolve({ handshake, detail, mode: options.mode, directory: run.directory })
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
			const decoded = recordFrame(run, 'recv', 'server-frame', frame)
			if (!decoded) return
			if (decoded.messageType === MESSAGE.serverError) {
				finish('ok', `收到协议错误帧 0xF code=${decoded.errorCode ?? 'unknown'}`)
				return
			}
			if (decoded.messageType === MESSAGE.serverFull) {
				const summary = payloadSummary(decoded.payload).json as Record<string, unknown> | undefined
				const final = summary?.['result.is_final'] === true || summary?.['result.definite'] === true
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

async function getStsToken(keys: Keys): Promise<string> {
	const response = await fetch('https://openspeech.bytedance.com/api/v1/sts/token', {
		method: 'POST',
		headers: {
			Authorization: `Bearer; ${keys.accessKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ appid: keys.appKey, duration: 300 }),
	})
	const body = await response.text()
	if (!response.ok) {
		const digest = createHash('sha256').update(body).digest('hex').slice(0, 16)
		throw new Error(`STS token HTTP ${response.status}; body sha256=${digest}`)
	}
	const parsed: unknown = JSON.parse(body)
	if (
		typeof parsed !== 'object' ||
		parsed === null ||
		typeof (parsed as { jwt_token?: unknown }).jwt_token !== 'string'
	) {
		throw new Error('STS token 响应缺少 jwt_token 字段')
	}
	console.log('  STS token 获取成功（token 值不输出）')
	return (parsed as { jwt_token: string }).jwt_token
}

function makeQuery(keys: Keys, accessKey: string): { url: string; queryNames: string[] } {
	const url = `${ENDPOINT}?api_resource_id=${encodeURIComponent(RESOURCE_ID)}&api_app_key=${encodeURIComponent(keys.appKey)}&api_access_key=${encodeURIComponent(accessKey)}`
	return { url, queryNames: queryNames(url) }
}

function optionsFor(mode: ProbeMode, keys: Keys, jwtToken?: string): ProbeOptions {
	if (mode === 'header') {
		return {
			mode,
			url: ENDPOINT,
			queryNames: [],
			headers: {
				'X-Api-App-Key': keys.appKey,
				'X-Api-Access-Key': keys.accessKey,
				'X-Api-Resource-Id': RESOURCE_ID,
			},
			audioFormat: 'pcm',
			endVariant: 'neg-with-seq',
			fault: 'none',
		}
	}
	const authValue = mode === 'query-jwt' ? `Jwt; ${jwtToken ?? ''}` : keys.accessKey
	const query = makeQuery(keys, authValue)
	return {
		mode,
		url: query.url,
		queryNames: query.queryNames,
		audioFormat: mode === 'opus' ? 'opus' : 'pcm',
		endVariant: mode === 'end-variant-neg-no-seq' ? 'neg-no-seq' : 'neg-with-seq',
		fault: mode === 'protocol-error' ? 'protocol' : mode === 'business-error' ? 'business' : 'none',
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
	if (!results.some((result) => result.mode.startsWith('query-') && result.handshake === 'ok')) {
		console.log(
			'结论：query 鉴权未成功，直连 no-go；请结合 header 对照组区分密钥问题与 query 鉴权支持问题。',
		)
	}
}

async function runAuthCandidates(
	keys: Keys,
	requested: string[],
	runAll: boolean,
): Promise<{ results: ProbeResult[]; jwtToken?: string }> {
	const results: ProbeResult[] = []
	let jwtToken: string | undefined
	const run = async (mode: ProbeMode, token?: string): Promise<ProbeResult> => {
		const result = await runProbe(optionsFor(mode, keys, token))
		results.push(result)
		return result
	}

	for (const mode of ['query-raw', 'query-jwt', 'header'] as const) {
		if (!runAll && !requested.includes(mode)) continue
		if (mode === 'query-jwt') {
			try {
				jwtToken = await getStsToken(keys)
				await run(mode, jwtToken)
			} catch (error: unknown) {
				const detail = `STS 阶段失败：${error instanceof Error ? error.message : String(error)}`
				console.error(`  query-jwt 中止：${detail}`)
				results.push({ handshake: 'fail', detail, mode, directory: 'not-created' })
			}
		} else {
			await run(mode)
		}
	}
	const anyHandshake = results.some((result) => result.handshake === 'ok')
	const followups: [boolean, ProbeMode][] = [
		[runAll || requested.includes('end-variant'), 'end-variant-neg-no-seq'],
		[runAll || requested.includes('opus'), 'opus'],
		[runAll || requested.includes('protocol-error'), 'protocol-error'],
		[runAll || requested.includes('business-error'), 'business-error'],
	]
	for (const [enabled, mode] of followups) if (anyHandshake && enabled) await run(mode, jwtToken)
	return { results, jwtToken }
}

main().catch((error: unknown) => {
	console.error(`FATAL: ${error instanceof Error ? error.message : String(error)}`)
	process.exitCode = 2
})
