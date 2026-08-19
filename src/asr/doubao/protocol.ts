const HEADER_VERSION = 1
const HEADER_SIZE_WORDS = 1
const SERIALIZATION_JSON = 1
const COMPRESSION_NONE = 0

export const SAUC_MESSAGE = {
	fullRequest: 0x1,
	audio: 0x2,
	serverResponse: 0x9,
	error: 0xf,
} as const

export interface FullRequestOptions {
	readonly uid?: string
	readonly modelName?: string
	readonly showUtterances?: boolean
	readonly enablePunctuation?: boolean
}

export interface DecodedFullRequest {
	readonly kind: 'full-request'
	readonly flags: 0
	readonly payload: Uint8Array
	readonly payloadText: string
	readonly json: unknown
}

export interface DecodedAudioFrame {
	readonly kind: 'audio'
	readonly flags: 0 | 2 | 3
	readonly payload: Uint8Array
	readonly sequence?: number
}

export interface DecodedServerResponse {
	readonly kind: 'server-response'
	readonly flags: 0 | 3
	readonly payload: Uint8Array
	readonly payloadText: string
	readonly json: unknown
	readonly sequence?: number
}

export interface DecodedErrorFrame {
	readonly kind: 'error'
	readonly flags: 0
	readonly errorCode: number
	readonly payload: Uint8Array
	readonly payloadText: string
	readonly json: unknown
}

export type DecodedFrame =
	| DecodedFullRequest
	| DecodedAudioFrame
	| DecodedServerResponse
	| DecodedErrorFrame

function toBytes(payload: Uint8Array | ArrayBuffer | string): Uint8Array {
	if (typeof payload === 'string') {
		return new TextEncoder().encode(payload)
	}
	if (payload instanceof Uint8Array) {
		return payload
	}
	return new Uint8Array(payload)
}

function header(messageType: number, flags: number): Uint8Array {
	return Uint8Array.from([
		(HEADER_VERSION << 4) | HEADER_SIZE_WORDS,
		(messageType << 4) | flags,
		(SERIALIZATION_JSON << 4) | COMPRESSION_NONE,
		0,
	])
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
	new DataView(target.buffer, target.byteOffset, target.byteLength).setUint32(offset, value)
}

function writeInt32(target: Uint8Array, offset: number, value: number): void {
	new DataView(target.buffer, target.byteOffset, target.byteLength).setInt32(offset, value)
}

function frameWithLength(
	messageType: number,
	flags: number,
	sequence: number | undefined,
	payload: Uint8Array,
): Uint8Array {
	const sequenceBytes = sequence === undefined ? 0 : 4
	const lengthOffset = 4 + sequenceBytes
	const result = new Uint8Array(8 + sequenceBytes + payload.byteLength)
	result.set(header(messageType, flags), 0)
	if (sequence !== undefined) writeInt32(result, 4, sequence)
	writeUint32(result, lengthOffset, payload.byteLength)
	result.set(payload, lengthOffset + 4)
	return result
}

/** Encode the initial JSON request frame sent before PCM audio. */
export function encodeFullRequest(payload: Uint8Array | ArrayBuffer | string): Uint8Array {
	const bytes = toBytes(payload)
	return frameWithLength(SAUC_MESSAGE.fullRequest, 0, undefined, bytes)
}

/** Build the request body used by the documented PCM SAUC flow. */
export function createFullRequest(options: FullRequestOptions = {}): Uint8Array {
	const payload = {
		user: { uid: options.uid ?? 'remobi' },
		audio: { format: 'pcm', rate: 16_000, bits: 16, channel: 1 },
		request: {
			model_name: options.modelName ?? 'bigmodel',
			show_utterances: options.showUtterances ?? true,
			enable_punc: options.enablePunctuation ?? true,
		},
	}
	return encodeFullRequest(JSON.stringify(payload))
}

/** Encode one raw PCM s16le frame. */
export function encodeAudioFrame(pcm: Uint8Array | ArrayBuffer): Uint8Array {
	return frameWithLength(SAUC_MESSAGE.audio, 0, undefined, toBytes(pcm))
}

/** Encode a stop frame with the service-accepted no-sequence variant. */
export function encodeEndFrame(): Uint8Array
/** Encode a stop frame carrying the negative audio-count sequence. */
export function encodeEndFrame(sequence: number): Uint8Array
export function encodeEndFrame(sequence?: number): Uint8Array {
	return frameWithLength(
		SAUC_MESSAGE.audio,
		sequence === undefined ? 2 : 3,
		sequence,
		new Uint8Array(),
	)
}

function readUint32(bytes: Uint8Array, offset: number): number {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset)
}

function readInt32(bytes: Uint8Array, offset: number): number {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset)
}

function readSequence(bytes: Uint8Array, flags: number): number | undefined {
	if (flags !== 3) return undefined
	if (bytes.byteLength < 12) malformed('sequence frame is truncated')
	return readInt32(bytes, 4)
}

function parseJson(bytes: Uint8Array): { readonly payloadText: string; readonly json: unknown } {
	const text = new TextDecoder().decode(bytes)
	try {
		const json: unknown = JSON.parse(text)
		return { payloadText: text, json }
	} catch {
		return { payloadText: text, json: undefined }
	}
}

function malformed(message: string): never {
	throw new Error(`Invalid SAUC frame: ${message}`)
}

function payloadSlice(bytes: Uint8Array, lengthOffset: number): Uint8Array {
	if (bytes.byteLength < lengthOffset + 4) malformed('missing payload length')
	const length = readUint32(bytes, lengthOffset)
	const payloadOffset = lengthOffset + 4
	if (length !== bytes.byteLength - payloadOffset) {
		malformed(`payload length ${length} does not match ${bytes.byteLength - payloadOffset}`)
	}
	return bytes.slice(payloadOffset)
}

function validateHeader(bytes: Uint8Array): {
	readonly messageType: number
	readonly flags: number
} {
	if (bytes.byteLength < 4) malformed('header is truncated')
	if (bytes[0] !== 0x11) malformed('unsupported version or header size')
	if (bytes[2] !== 0x10 || bytes[3] !== 0) malformed('unsupported serialization or compression')
	const messageByte = bytes[1]
	if (messageByte === undefined) malformed('missing message type')
	return { messageType: messageByte >> 4, flags: messageByte & 0x0f }
}

function decodeFullRequest(bytes: Uint8Array, flags: number): DecodedFullRequest {
	if (flags !== 0) malformed('full request flags must be zero')
	const payload = payloadSlice(bytes, 4)
	const parsed = parseJson(payload)
	return { kind: 'full-request', flags: 0, payload, ...parsed }
}

function decodeAudio(bytes: Uint8Array, flags: number): DecodedAudioFrame {
	if (flags !== 0 && flags !== 2 && flags !== 3) malformed('unsupported audio flags')
	const sequence = readSequence(bytes, flags)
	const payload = payloadSlice(bytes, flags === 3 ? 8 : 4)
	if ((flags === 2 || flags === 3) && payload.byteLength !== 0) {
		malformed('end frame must have an empty payload')
	}
	return sequence === undefined
		? { kind: 'audio', flags, payload }
		: { kind: 'audio', flags, sequence, payload }
}

function decodeServerResponse(bytes: Uint8Array, flags: number): DecodedServerResponse {
	if (flags !== 0 && flags !== 3) malformed('unsupported server response flags')
	const sequence = readSequence(bytes, flags)
	const payload = payloadSlice(bytes, flags === 3 ? 8 : 4)
	const parsed = parseJson(payload)
	return sequence === undefined
		? { kind: 'server-response', flags, payload, ...parsed }
		: { kind: 'server-response', flags, sequence, payload, ...parsed }
}

function decodeError(bytes: Uint8Array, flags: number): DecodedErrorFrame {
	if (flags !== 0) malformed('error flags must be zero')
	if (bytes.byteLength < 12) malformed('error frame is truncated')
	const errorCode = readUint32(bytes, 4)
	const payload = payloadSlice(bytes, 8)
	const parsed = parseJson(payload)
	return { kind: 'error', flags: 0, errorCode, payload, ...parsed }
}

/** Decode a SAUC frame and reject malformed or unsupported wire bytes. */
export function decodeFrame(input: Uint8Array | ArrayBuffer): DecodedFrame {
	const bytes = toBytes(input)
	const { messageType, flags } = validateHeader(bytes)
	if (messageType === SAUC_MESSAGE.fullRequest) return decodeFullRequest(bytes, flags)
	if (messageType === SAUC_MESSAGE.audio) return decodeAudio(bytes, flags)
	if (messageType === SAUC_MESSAGE.serverResponse) return decodeServerResponse(bytes, flags)
	if (messageType === SAUC_MESSAGE.error) return decodeError(bytes, flags)
	return malformed(`unsupported message type 0x${messageType.toString(16)}`)
}
