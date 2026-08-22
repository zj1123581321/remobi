export default {
	name: 'herdweb ASR e2e',
	asr: {
		enabled: true,
		provider: 'doubao',
		doubao: { apiKey: 'test-api-key', resourceId: 'volc.seedasr.sauc.duration' },
		autoEnter: true,
	},
	toolbar: {
		row1: [
			{
				id: 'voice-input',
				label: 'Mic',
				description: 'Open voice composer',
				action: { type: 'voice-input' },
			},
		],
	},
}
