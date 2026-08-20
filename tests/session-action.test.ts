import { describe, expect, test, vi } from 'vitest'
import { SharedTerminalSession } from '../src/session'
import type { ServerMessage } from '../src/session-protocol'

function recorder() {
	const messages: ServerMessage[] = []
	let closeCount = 0
	return {
		client: {
			send(message: ServerMessage) {
				messages.push(message)
			},
			close() {
				closeCount += 1
			},
		},
		messages,
		get closeCount() {
			return closeCount
		},
	}
}

function outputText(messages: readonly ServerMessage[]): string {
	return messages
		.filter(
			(message): message is Extract<ServerMessage, { type: 'output' }> => message.type === 'output',
		)
		.map((message) => message.data)
		.join('')
}

function acceptedIds(messages: readonly ServerMessage[]): string[] {
	return messages
		.filter(
			(message): message is Extract<ServerMessage, { type: 'input-accepted' }> =>
				message.type === 'input-accepted',
		)
		.map((message) => message.id)
}

describe('input-action session contract', () => {
	test('accepts once, re-accepts identical retries, and rejects conflicts without another PTY write', async () => {
		const session = new SharedTerminalSession(['bash', '--norc', '--noprofile', '-lc', 'cat'])
		const client = recorder()
		try {
			await session.addClient(client.client)
			session.handleClientMessage(client.client, {
				type: 'input-action',
				id: 'action-1',
				data: 'atomic-marker',
			})
			await vi.waitFor(() => expect(outputText(client.messages)).toContain('atomic-marker'))
			session.handleClientMessage(client.client, {
				type: 'input-action',
				id: 'action-1',
				data: 'atomic-marker',
			})
			session.handleClientMessage(client.client, {
				type: 'input-action',
				id: 'action-1',
				data: 'changed-marker',
			})

			expect(outputText(client.messages).match(/atomic-marker/g)).toHaveLength(1)
			expect(acceptedIds(client.messages)).toEqual(['action-1', 'action-1'])
			expect(client.messages.at(-1)).toEqual({
				type: 'input-rejected',
				id: 'action-1',
				reason: 'id-conflict',
			})
		} finally {
			await session.dispose()
		}
	})

	test('does not record a synchronous PTY write failure', async () => {
		const session = new SharedTerminalSession(['bash', '--norc', '--noprofile', '-lc', 'cat'])
		const client = recorder()
		const pty = (session as unknown as { pty: { write(data: string): void } }).pty
		const originalWrite = pty.write
		let writeCount = 0
		try {
			pty.write = () => {
				writeCount += 1
				throw new Error('write failed')
			}
			session.handleClientMessage(client.client, {
				type: 'input-action',
				id: 'retry-me',
				data: 'retry-marker',
			})
			expect(client.messages.at(-1)).toEqual({
				type: 'input-rejected',
				id: 'retry-me',
				reason: 'pty-write-failed',
			})

			pty.write = (data) => {
				writeCount += 1
				originalWrite.call(pty, data)
			}
			session.handleClientMessage(client.client, {
				type: 'input-action',
				id: 'retry-me',
				data: 'retry-marker',
			})
			expect(acceptedIds(client.messages)).toEqual(['retry-me'])
			expect(writeCount).toBe(2)
		} finally {
			pty.write = originalWrite
			await session.dispose()
		}
	})

	test('evicts the oldest action after 128 entries and then writes that ID again', async () => {
		const session = new SharedTerminalSession(['bash', '--norc', '--noprofile', '-lc', 'cat'])
		const client = recorder()
		try {
			await session.addClient(client.client)
			session.handleClientMessage(client.client, {
				type: 'input-action',
				id: 'oldest',
				data: 'fifo-marker',
			})
			for (let index = 1; index <= 128; index += 1) {
				session.handleClientMessage(client.client, {
					type: 'input-action',
					id: `action-${index}`,
					data: `fifo-${index}`,
				})
			}
			session.handleClientMessage(client.client, {
				type: 'input-action',
				id: 'oldest',
				data: 'fifo-marker',
			})
			await vi.waitFor(() =>
				expect(outputText(client.messages).match(/fifo-marker/g)).toHaveLength(2),
			)
			expect(acceptedIds(client.messages).filter((id) => id === 'oldest')).toHaveLength(2)
		} finally {
			await session.dispose()
		}
	})

	test('rejects action after exit and closes the requesting client while legacy input stays silent', async () => {
		const session = new SharedTerminalSession(['bash', '--norc', '--noprofile', '-lc', 'exit 0'])
		await session.onExit
		const client = recorder()

		session.handleClientMessage(client.client, {
			type: 'input-action',
			id: 'after-exit',
			data: 'ignored',
		})
		session.handleClientMessage(client.client, { type: 'input', data: 'ignored' })
		expect(client.messages).toEqual([
			{ type: 'input-rejected', id: 'after-exit', reason: 'session-unavailable' },
		])
		expect(client.closeCount).toBe(1)
		await session.dispose()
	})
})
