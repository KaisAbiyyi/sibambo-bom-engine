/**
 * illuminance.ts
 *
 * Maps room function and semantic confidence to target average illuminance (Lux),
 * work-plane height, and alternative function scenarios.
 */

import type { RoomAnalysisInput, IlluminanceRequirementResult, AnalysisValue } from './types';
import { getRoomUsageProfile } from './profiles';

export function calculateIlluminanceRequirement(input: RoomAnalysisInput): IlluminanceRequirementResult {
	const semantic = input.semantic;
	const primaryFn = semantic?.primaryFunction || 'unassigned';
	const profile = input.assumptions.usageProfile;
	const confidence = semantic?.confidence || 0.5;

	let applicability: 'direct_match' | 'uncertain_fallback' | 'generic_default' = 'direct_match';
	const alternatives: { function: any; targetLux: number }[] = [];

	if (primaryFn === 'unassigned') {
		applicability = 'generic_default';
	} else if (confidence < 0.6 || (semantic?.candidates && semantic.candidates.length > 1)) {
		applicability = 'uncertain_fallback';
		if (semantic?.candidates) {
			for (const cand of semantic.candidates.slice(1, 4)) {
				const altProfile = getRoomUsageProfile(cand.function);
				alternatives.push({
					function: cand.function,
					targetLux: altProfile.targetIlluminanceLux
				});
			}
		}
	}

	const targetLux: AnalysisValue<number> = {
		value: profile.targetIlluminanceLux,
		state: applicability === 'direct_match' ? 'calculated' : 'estimated',
		source: ['standard_profile', 'room_inference'],
		confidence,
		diagnostics: applicability === 'generic_default' ? ['Generic fallback illuminance assigned to unassigned room'] : []
	};

	return {
		targetLux,
		sourceProfile: `CIBSE / IESNA standard profile for ${primaryFn}`,
		semanticConfidence: confidence,
		workPlaneHeightM: profile.workPlaneHeightM,
		applicability,
		alternatives
	};
}
