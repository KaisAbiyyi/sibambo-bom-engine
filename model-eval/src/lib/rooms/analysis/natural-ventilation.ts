/**
 * natural-ventilation.ts
 *
 * First-order natural ventilation potential and airflow calculation.
 * Classifies ventilation type (no exterior, single-sided, cross, stack-assisted)
 * and estimates effective opening area, airflow rate (m³/s), and ACH.
 */

import type {
	RoomAnalysisInput,
	RoomAnalysisConfiguration,
	NaturalVentilationResult,
	AnalysisValue
} from './types';

export function calculateNaturalVentilation(
	input: RoomAnalysisInput,
	config: RoomAnalysisConfiguration
): NaturalVentilationResult {
	const missingInputs: string[] = [];
	const assumptions: string[] = [];
	const warnings: string[] = [];

	if (!Number.isFinite(input.geometry.volume) || input.geometry.volume < 0 || !Number.isFinite(input.geometry.floorArea)) {
		warnings.push('Non-finite or negative room dimensions detected; volume clamped for ACH');
	}

	const extOpenings = input.openings.filter((o) => o.isExterior && o.area > 0.1);
	const extCount = extOpenings.length;

	if (extCount === 0) {
		return {
			type: 'no_exterior_ventilation',
			effectiveOpeningAreaM2: {
				value: 0,
				state: 'calculated',
				source: ['model'],
				confidence: 0.95,
				diagnostics: ['No exterior openings present']
			},
			estimatedAirflowRateM3s: {
				value: 0,
				state: 'calculated',
				source: ['model'],
				confidence: 0.95,
				diagnostics: []
			},
			estimatedAch: {
				value: 0,
				state: 'calculated',
				source: ['model'],
				confidence: 0.95,
				diagnostics: ['Room lacks direct exterior ventilation']
			},
			windwardRelationship: 'unknown',
			confidence: 0.95,
			methodIdentifier: 'first_order_opening_balance',
			missingInputs,
			assumptions,
			trace: {
				method: 'First-Order Opening Balance',
				formula: 'Q = 0 (No exterior openings)',
				inputs: [
					{ name: 'Exterior Openings Count', value: 0, unit: 'count' },
					{ name: 'Room Volume', value: input.geometry.volume, unit: 'm³' }
				],
				intermediateValues: [],
				assumptions: ['Space is entirely reliant on mechanical ventilation or transfer air'],
				finalResult: { value: 0, unit: 'ACH' },
				confidence: 0.95,
				warnings
			}
		};
	}

	// Classify ventilation type
	let type: 'single_sided' | 'cross_ventilation' | 'stack_assisted' | 'unresolved' = 'single_sided';
	const totalExtArea = extOpenings.reduce((sum, o) => sum + o.area, 0);

	// Check orientation spread
	const orientations = extOpenings.map((o) => o.orientationDeg || 0);
	let hasOpposingOrAdjacent = false;
	for (let i = 0; i < orientations.length; i++) {
		for (let j = i + 1; j < orientations.length; j++) {
			const diff = Math.abs(orientations[i] - orientations[j]);
			const shortestAngle = Math.min(diff, 360 - diff);
			if (shortestAngle > 45) {
				hasOpposingOrAdjacent = true;
			}
		}
	}

	// Check stack separation
	const minSill = Math.min(...extOpenings.map((o) => o.sillElevation));
	const maxHead = Math.max(...extOpenings.map((o) => o.headElevation));
	const verticalSeparation = maxHead - minSill;
	const isStack = verticalSeparation > 2.5 || input.assumptions.usageProfile.function === 'staircase';

	if (hasOpposingOrAdjacent) {
		type = 'cross_ventilation';
	} else if (isStack && extCount > 1) {
		type = 'stack_assisted';
	}

	// Calculate effective area A_eff
	let effectiveArea = totalExtArea * 0.5; // default single sided
	if (type === 'cross_ventilation' && extCount >= 2) {
		const sorted = [...extOpenings].sort((a, b) => b.area - a.area);
		const a1 = sorted[0].area;
		const a2 = sorted.slice(1).reduce((sum, o) => sum + o.area, 0);
		effectiveArea = (Math.SQRT2 * a1 * a2) / Math.sqrt(a1 * a1 + a2 * a2);
	}

	// Windward relationship against local wind direction
	// Wind direction config is where wind blows from (e.g. 180 = South wind blowing North)
	// If opening faces 180 (South), it is directly windward
	const windDir = config.localWindDirectionDeg;
	let windwardRelationship: 'windward' | 'leeward' | 'parallel' | 'sheltered' | 'unknown' = 'parallel';
	let primaryOrient = orientations[0];

	const angleDiffs = extOpenings.map((o) => {
		const orient = o.orientationDeg || 0;
		const diff = Math.abs(orient - windDir);
		return Math.min(diff, 360 - diff);
	});
	const minDiffToWind = Math.min(...angleDiffs);

	if (minDiffToWind <= 45) {
		windwardRelationship = 'windward';
		const idx = angleDiffs.indexOf(minDiffToWind);
		if (idx >= 0) primaryOrient = orientations[idx];
	} else if (minDiffToWind >= 135) {
		windwardRelationship = 'leeward';
	}

	assumptions.push(`Wind speed: ${config.localWindSpeedMs} m/s, Wind direction: ${config.localWindDirectionDeg}°`);
	assumptions.push(`Discharge coefficient Cv = 0.60, Cd = 0.65`);

	// Airflow calculation
	const cv = 0.60;
	const qWind = cv * effectiveArea * config.localWindSpeedMs;

	const cd = 0.65;
	const tempDiff = Math.abs(input.assumptions.indoorDesignTempC - input.assumptions.outdoorDesignTempC);
	const absOutTempK = input.assumptions.outdoorDesignTempC + 273.15;
	const qStack = cd * effectiveArea * Math.sqrt((2 * 9.81 * verticalSeparation * tempDiff) / absOutTempK);

	const qTotal = Math.round(Math.max(qWind, qStack) * 100) / 100;
	const volume = Math.max(1.0, input.geometry.volume);
	const ach = Math.round(((qTotal * 3600.0) / volume) * 10) / 10;

	return {
		type,
		effectiveOpeningAreaM2: {
			value: Math.round(effectiveArea * 100) / 100,
			state: 'calculated',
			source: ['model'],
			confidence: 0.85,
			diagnostics: []
		},
		estimatedAirflowRateM3s: {
			value: qTotal,
			state: 'calculated',
			source: ['model', 'user_config'],
			confidence: 0.8,
			diagnostics: [`Wind-driven: ${qWind.toFixed(2)} m³/s, Stack-driven: ${qStack.toFixed(2)} m³/s`]
		},
		estimatedAch: {
			value: ach,
			state: 'calculated',
			source: ['model', 'user_config'],
			confidence: 0.8,
			diagnostics: [`ACH: ${ach.toFixed(1)} exchanges/hour`]
		},
		windwardRelationship,
		airflowDirectionDeg: {
			value: Math.round(primaryOrient),
			state: 'estimated',
			source: ['model'],
			confidence: 0.75,
			diagnostics: []
		},
		confidence: 0.8,
		methodIdentifier: 'first_order_opening_balance',
		missingInputs,
		assumptions,
		trace: {
			method: 'First-Order Opening Balance & Stack-Assisted Airflow',
			formula: 'Q_total = max(Q_wind, Q_stack); Q_wind = C_v * A_eff * v_wind; ACH = Q_total * 3600 / V',
			inputs: [
				{ name: 'Effective Opening Area', value: Math.round(effectiveArea * 100) / 100, unit: 'm²' },
				{ name: 'Room Volume', value: volume, unit: 'm³' },
				{ name: 'Wind Speed', value: config.localWindSpeedMs, unit: 'm/s' },
				{ name: 'Wind Direction', value: config.localWindDirectionDeg, unit: 'deg' }
			],
			intermediateValues: [
				{ name: 'Wind-driven Airflow Q_wind', value: Math.round(qWind * 100) / 100, unit: 'm³/s' },
				{ name: 'Stack-driven Airflow Q_stack', value: Math.round(qStack * 100) / 100, unit: 'm³/s' }
			],
			assumptions,
			finalResult: { value: ach, unit: 'ACH' },
			confidence: 0.8,
			warnings
		}
	};
}
