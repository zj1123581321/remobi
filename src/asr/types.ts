export type AsrErrorCode =
	| 'unsupported'
	| 'permission-denied'
	| 'audio-context'
	| 'unsupported-sample-rate'
	| 'connection-failed'
	| 'socket-closed'
	| 'protocol-error'
	| 'provider-error'
	| 'network-too-slow'
	| 'stopped'

export type AsrTextHandler = (text: string) => void
export type AsrErrorHandler = (error: AsrErrorCode) => void
export type AsrUnsubscribe = () => void

/** Minimal provider-independent streaming ASR contract. */
export interface AsrEngine {
	start(): Promise<void>
	stop(): Promise<void>
	isSupported(): boolean
	onPartial(handler: AsrTextHandler): AsrUnsubscribe
	onFinal(handler: AsrTextHandler): AsrUnsubscribe
	onError(handler: AsrErrorHandler): AsrUnsubscribe
}
