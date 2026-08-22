import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { bundleWorkletAsset, writeWorkletBundle } from '../build'

describe('ASR worklet build', () => {
	test('bundles the source worklet entry', async () => {
		const asset = await bundleWorkletAsset()
		expect(asset).toContain('registerProcessor')
		expect(asset).toContain('herdweb-pcm-processor')
		expect(asset).toContain('posted')
	})

	test('build overlay always writes the current source bundle', async () => {
		const esbuild = await import('esbuild')
		const result = await esbuild.build({
			entryPoints: [resolve('src/asr/worklet-entry.ts')],
			bundle: true,
			platform: 'browser',
			minify: true,
			format: 'iife',
			outdir: 'out',
			write: false,
		})
		const sourceOutput = result.outputFiles.find((file) => file.path.endsWith('.js'))
		if (!sourceOutput) throw new Error('expected source worklet output')

		const outputDir = mkdtempSync(join(tmpdir(), 'herdweb-worklet-'))
		try {
			await writeWorkletBundle(outputDir)
			expect(readFileSync(join(outputDir, 'asr-worklet.js'), 'utf8')).toBe(sourceOutput.text)
		} finally {
			rmSync(outputDir, { recursive: true, force: true })
		}
	})

	test('bundled worklet reports unknown commands', async () => {
		const asset = await bundleWorkletAsset()
		expect(asset).toContain('unknown-worklet-command')
	})
})
