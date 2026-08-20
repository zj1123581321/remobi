import { defineConfig } from './src/config'

const micButton = {
	id: 'mic',
	label: 'Mic',
	description: 'Tap to speak',
	action: { type: 'voice-input' as const },
}

export default defineConfig({
	toolbar: {
		// Keep the standard keys, with voice input at the right edge.
		row1: (defaults) => [...defaults, micButton],
	},
})
