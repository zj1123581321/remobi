/**
 * Engine error conditions: unsupported means capability detection failed;
 * permission-denied comes from getUserMedia; audio-context/worklet/sample-rate
 * identify capture setup failures; connection/socket/provider/protocol/network
 * codes identify provider transport or wire failures. `audio-interrupted` is
 * reserved for a non-user-initiated microphone interruption and is never emitted by a normal stop.
 */
export type AsrErrorCode =
	| 'unsupported'
	| 'permission-denied'
	| 'audio-context'
	| 'audio-interrupted'
	| 'unsupported-sample-rate'
	| 'worklet-load-failed'
	| 'connection-failed'
	| 'socket-closed'
	| 'protocol-error'
	| 'provider-error'
	| 'network-too-slow'

export type AsrTextHandler = (text: string) => void
/** Final sequence is provider order; consumers must discard sequence <= their applied sequence. */
export type AsrFinalHandler = (text: string, sequence?: number) => void
export type AsrErrorHandler = (error: AsrErrorCode) => void
export type AsrUnsubscribe = () => void

/**
 * Minimal provider-independent streaming ASR contract.
 * `audio-interrupted` is an external interruption, never a normal stop result.
 * Providers report permission/provider/protocol failures through onError.
 */
export interface AsrEngine {
	start(): Promise<void>
	stop(): Promise<void>
	isSupported(): boolean
	onPartial(handler: AsrTextHandler): AsrUnsubscribe
	onFinal(handler: AsrFinalHandler): AsrUnsubscribe
	onError(handler: AsrErrorHandler): AsrUnsubscribe
}
