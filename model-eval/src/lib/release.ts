export const RELEASE = {
	version: '0.6.0-rc.1',
	build: '0a8bc39',
	date: '2026-07-16',
	supportedWorkflow: 'Upload BOM JSON/BOME2 → review rooms → calibrate → analyze → recommend/optimize → export JSON or HTML.',
	knownLimitations: 'Room detection is heuristic; analysis and optimization are bounded engineering estimates, not certification results.',
	disclaimer: 'Preliminary engineering estimate only. Verify critical decisions with a licensed engineer.'
} as const;
