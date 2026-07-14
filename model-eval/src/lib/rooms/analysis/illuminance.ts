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
	const warnings: string[] = [];

	if (!Number.isFinite(input.geometry.floorArea) || input.geometry.floorArea < 0 || !Number.isFinite(profile.workPlaneHeightM) || profile.workPlaneHeightM < 0) {
		warnings.push('Non-finite or negative geometry dimensions detected in illuminance profile lookup');
	}

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
		alternatives,
		trace: {
			method: 'Standard Profile Illuminance Mapping',
			formula: 'TargetLux = Profile(primaryFunction).targetIlluminanceLux; WorkPlane = Profile(primaryFunction).workPlaneHeightM',
			inputs: [
				{ name: 'Primary Function', value: primaryFn, unit: 'category' },
				{ name: 'Semantic Confidence', value: confidence, unit: 'ratio (0-1)' },
				{ name: 'Floor Area', value: input.geometry.floorArea, unit: 'm²' }
			],
			intermediateValues: [
				{ name: 'Profile Target Lux', value: profile.targetIlluminanceLux, unit: 'lux' },
				{ name: 'Work Plane Height', value: profile.workPlaneHeightM, unit: 'm' }
			],
			assumptions: [`Mapped from CIBSE / IESNA standard profile for ${primaryFn}`],
			finalResult: { value: profile.targetIlluminanceLux, unit: 'lux' },
			confidence,
			warnings
		}
	};
}
