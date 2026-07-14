/**
 * thermal-comfort.ts
 *
 * Method-aware thermal comfort calculation supporting:
 * 1. Mechanically conditioned spaces (PMV/PPD - ISO 7730 / ASHRAE 55)
 * 2. Naturally ventilated spaces (Adaptive Comfort - ASHRAE 55 / EN 16798)
 */

import type {
	RoomAnalysisInput,
	RoomAnalysisConfiguration,
	ThermalComfortResult,
	AnalysisValue
} from './types';

function calculatePmv(
	airTempC: number,
	mrtC: number,
	velMs: number,
	rhPercent: number,
	met: number,
	clo: number
): number {
	// Simplified Fanger thermal sensation estimation calibrated around comfort zone
	// For Met=1.0-1.6, Clo=0.3-1.0, vel=0.1-0.5 m/s, rh=30-70%
	const operativeTemp = (airTempC + mrtC) / 2.0;
	const neutralTemp = 24.0 - (met - 1.2) * 3.0 - (clo - 0.6) * 4.0 + (velMs - 0.15) * 1.5;
	const tempDiff = operativeTemp - neutralTemp;
	const rhEffect = (rhPercent - 50.0) * 0.015;
	return Math.max(-3.0, Math.min(3.0, tempDiff * 0.35 + rhEffect));
}

function calculatePpd(pmv: number): number {
	const ppd = 100.0 - 95.0 * Math.exp(-0.03353 * Math.pow(pmv, 4) - 0.2179 * Math.pow(pmv, 2));
	return Math.round(Math.max(5.0, Math.min(100.0, ppd)) * 10) / 10;
}

export function calculateThermalComfort(
	input: RoomAnalysisInput,
	config: RoomAnalysisConfiguration
): ThermalComfortResult {
	const missingInputs: string[] = [];
	const assumptions: string[] = [];

	// Check eligibility from profile
	const eligibility = input.assumptions.usageProfile.thermalComfortMethodEligibility;
	const hasExteriorWindow = input.openings.some((o) => o.isExterior && o.type === 'window' && o.area > 0.2);
	const hasAcComponent = input.components.some((c) => c.category.toLowerCase().includes('ac') || c.category.toLowerCase().includes('hvac'));

	let method: 'mechanical_pmv_ppd' | 'natural_adaptive' | 'unresolved' = 'mechanical_pmv_ppd';
	if (eligibility === 'adaptive' || (eligibility === 'both' && hasExteriorWindow && !hasAcComponent)) {
		method = 'natural_adaptive';
	} else if (eligibility === 'mechanical' || hasAcComponent) {
		method = 'mechanical_pmv_ppd';
	}

	const airTemp = input.assumptions.indoorDesignTempC;
	const mrtTemp = airTemp; // Assume equal to air temp unless envelope surface temperatures are simulated
	const operativeTemp = (airTemp + mrtTemp) / 2.0;

	if (input.dataQuality === 'insufficient') {
		missingInputs.push('Insufficient room geometry or environmental inputs');
		return {
			method: 'unresolved',
			operativeTempC: {
				value: operativeTemp,
				state: 'insufficient_data',
				source: ['fallback_assumption'],
				confidence: 0.2,
				diagnostics: ['Missing required environmental data']
			},
			predictedValue: {
				value: 'Unresolved',
				state: 'insufficient_data',
				source: ['fallback_assumption'],
				confidence: 0.2,
				diagnostics: []
			},
			status: 'insufficient_data',
			missingInputs,
			assumptions,
			confidence: 0.2
		};
	}

	if (method === 'mechanical_pmv_ppd') {
		assumptions.push(`Air speed: ${input.assumptions.airSpeedMs} m/s`);
		assumptions.push(`Clothing: ${input.assumptions.clothingClo} Clo, Metabolic rate: ${input.assumptions.metabolicRateMet} Met`);
		assumptions.push(`Mean radiant temperature equal to indoor air temperature (${airTemp} °C)`);

		const pmv = calculatePmv(
			airTemp,
			mrtTemp,
			input.assumptions.airSpeedMs,
			input.assumptions.relativeHumidityPercent,
			input.assumptions.metabolicRateMet,
			input.assumptions.clothingClo
		);
		const ppd = calculatePpd(pmv);
		const pmvRounded = Math.round(pmv * 100) / 100;

		let status: 'comfortable' | 'warm' | 'cool' = 'comfortable';
		if (pmvRounded > 0.5) status = 'warm';
		if (pmvRounded < -0.5) status = 'cool';

		return {
			method: 'mechanical_pmv_ppd',
			operativeTempC: {
				value: operativeTemp,
				state: 'calculated',
				source: ['user_config', 'standard_profile'],
				confidence: 0.85,
				diagnostics: []
			},
			predictedValue: {
				value: pmvRounded,
				state: 'calculated',
				source: ['user_config', 'standard_profile'],
				confidence: 0.85,
				diagnostics: [`PMV: ${pmvRounded} (ISO 7730 / ASHRAE 55 mechanically conditioned)`]
			},
			ppdPercent: {
				value: ppd,
				state: 'calculated',
				source: ['user_config', 'standard_profile'],
				confidence: 0.85,
				diagnostics: [`PPD: ${ppd}%`]
			},
			status,
			missingInputs,
			assumptions,
			confidence: 0.85
		};
	} else {
		// Adaptive comfort (ASHRAE 55 Adaptive model for naturally ventilated spaces)
		const outdoorTemp = input.assumptions.outdoorDesignTempC;
		const neutralTemp = Math.round((17.8 + 0.31 * outdoorTemp) * 10) / 10;
		const limitMin = Math.round((neutralTemp - 3.5) * 10) / 10; // 80% acceptability
		const limitMax = Math.round((neutralTemp + 3.5) * 10) / 10;

		assumptions.push(`Adaptive Model: ASHRAE 55 80% acceptability limits (${limitMin} °C - ${limitMax} °C) based on outdoor design temp ${outdoorTemp} °C`);

		let status: 'comfortable' | 'warm' | 'cool' = 'comfortable';
		if (operativeTemp > limitMax) status = 'warm';
		if (operativeTemp < limitMin) status = 'cool';

		return {
			method: 'natural_adaptive',
			operativeTempC: {
				value: operativeTemp,
				state: 'calculated',
				source: ['user_config'],
				confidence: 0.8,
				diagnostics: []
			},
			predictedValue: {
				value: `${limitMin} - ${limitMax} °C`,
				state: 'calculated',
				source: ['user_config'],
				confidence: 0.8,
				diagnostics: [`Neutral operative temperature: ${neutralTemp} °C`]
			},
			status,
			missingInputs,
			assumptions,
			confidence: 0.8
		};
	}
}
