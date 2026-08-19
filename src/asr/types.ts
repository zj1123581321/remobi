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
	| 'stopped'

export type AsrTextHandler = (text: string) => void
export type AsrFinalHandler = (text: string, sequence?: number) => void
export type AsrErrorHandler = (error: AsrErrorCode) => void
export type AsrUnsubscribe = () => void

/** Minimal provider-independent streaming ASR contract; final sequence is passed when present for consumer-side deduplication. */
export interface AsrEngine {
	start(): Promise<void>
	stop(): Promise<void>
	isSupported(): boolean
	onPartial(handler: AsrTextHandler): AsrUnsubscribe
	onFinal(handler: AsrFinalHandler): AsrUnsubscribe
	onError(handler: AsrErrorHandler): AsrUnsubscribe
}
