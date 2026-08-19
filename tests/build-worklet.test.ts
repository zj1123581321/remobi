import { describe, expect, test } from 'vitest'
import { bundleWorkletAsset } from '../build'

describe('ASR worklet build', () => {
	test('bundles the source worklet entry', async () => {
		const asset = await bundleWorkletAsset()
		expect(asset).toContain('registerProcessor')
		expect(asset).toContain('remobi-pcm-processor')
	})
})
