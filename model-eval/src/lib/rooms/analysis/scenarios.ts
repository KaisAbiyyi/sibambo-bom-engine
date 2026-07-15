/**
 * scenarios.ts
 *
 * Contracts and engine for Task 3E: Design-Scenario Comparison.
 * Enables non-destructive, immutable evaluations of baseline vs. proposed
 * architectural and operational assumptions across room and building analysis modules.
 */

import type { DetectedRoom } from '../detected-room';
import type { RoomTopologyGraph } from '../topology';
import type { RoomSemanticInference, RoomFunction } from '../semantics';
import {
	DEFAULT_ANALYSIS_CONFIGURATION,
	type RoomAnalysisConfiguration,
	type BuildingAnalysisResult,
	type RoomAnalysisInput,
	type RoomAnalysisResult
} from './types';
import { buildRoomAnalysisInputs } from './adapter';
import { calculateThermalComfort } from './thermal-comfort';
import { calculateHumanFlow } from './human-flow';
import { calculateNaturalVentilation } from './natural-ventilation';
import { calculateCoolingCapacity } from './cooling-capacity';
import { calculateIlluminanceRequirement } from './illuminance';
import { calculateArtificialLighting } from './artificial-lighting';
import { calculateBuildingOttv } from './ottv';
import { getRoomUsageProfile } from './profiles';

export type DesignScenarioOverrides = Partial<RoomAnalysisConfiguration> & {
	// Room & Occupancy overrides
	roomFunctionOverrides?: Record<string, RoomFunction>;
	occupancyMultiplier?: number;
	roomOccupancyOverrides?: Record<string, number>;

	// Envelope overrides applied to surfaces/openings
	wallUValueMultiplier?: number;
	glazingUValueMultiplier?: number;
	shadingCoefficientMultiplier?: number;
	solarFactorMultiplier?: number;
	windowAreaMultiplier?: number;
	wwrOverride?: number; // clamps or sets target glazing ratio
	isHVACConditionedOverride?: boolean;
};

export type DesignScenario = {
	id: string;
	name: string;
	description: string;
	isBaseline: boolean;
	overrides: DesignScenarioOverrides;
};

export const DEFAULT_BASELINE_SCENARIO: DesignScenario = {
	id: 'baseline',
	name: 'Baseline Design',
	description: 'Default architectural model geometry and standard operational assumptions',
	isBaseline: true,
	overrides: {}
};

export const DEFAULT_PROPOSED_SCENARIO: DesignScenario = {
	id: 'proposed_efficiency',
	name: 'Proposed High-Efficiency Envelope',
	description: 'Improved low-E glazing (U=2.1, SC=0.45), LED efficiency (4500 lm), and optimized ventilation',
	isBaseline: false,
	overrides: {
		defaultGlazingUValue: 2.1,
		defaultShadingCoefficient: 0.45,
		defaultSolarFactor: 0.40,
		defaultLuminaireFluxLm: 4500,
		defaultLuminaireWattageW: 28,
		coefficientOfUtilization: 0.75,
		lightLossFactor: 0.85
	}
};

export type ScenarioValidationResult = {
	isValid: boolean;
	errors: string[];
};

export function validateScenarioOverrides(overrides: DesignScenarioOverrides): ScenarioValidationResult {
	const errors: string[] = [];

	// Validate numerical boundaries
	if (overrides.indoorDesignTempC !== undefined && (!Number.isFinite(overrides.indoorDesignTempC) || overrides.indoorDesignTempC < -50 || overrides.indoorDesignTempC > 60)) {
		errors.push(`Invalid indoorDesignTempC: ${overrides.indoorDesignTempC} (must be finite [-50, 60] °C)`);
	}
	if (overrides.outdoorDesignTempC !== undefined && (!Number.isFinite(overrides.outdoorDesignTempC) || overrides.outdoorDesignTempC < -60 || overrides.outdoorDesignTempC > 60)) {
		errors.push(`Invalid outdoorDesignTempC: ${overrides.outdoorDesignTempC} (must be finite [-60, 60] °C)`);
	}
	if (overrides.relativeHumidityPercent !== undefined && (!Number.isFinite(overrides.relativeHumidityPercent) || overrides.relativeHumidityPercent < 0 || overrides.relativeHumidityPercent > 100)) {
		errors.push(`Invalid relativeHumidityPercent: ${overrides.relativeHumidityPercent} (must be finite [0, 100] %)`);
	}
	if (overrides.localWindSpeedMs !== undefined && (!Number.isFinite(overrides.localWindSpeedMs) || overrides.localWindSpeedMs < 0 || overrides.localWindSpeedMs > 100)) {
		errors.push(`Invalid localWindSpeedMs: ${overrides.localWindSpeedMs} (must be non-negative and finite [0, 100] m/s)`);
	}
	if (overrides.localWindDirectionDeg !== undefined && !Number.isFinite(overrides.localWindDirectionDeg)) {
		errors.push(`Invalid localWindDirectionDeg: ${overrides.localWindDirectionDeg} (must be finite angle)`);
	}
	if (overrides.projectNorthDeg !== undefined && overrides.projectNorthDeg !== null && !Number.isFinite(overrides.projectNorthDeg)) {
		errors.push(`Invalid projectNorthDeg: ${overrides.projectNorthDeg} (must be finite or null)`);
	}
	if (overrides.coefficientOfUtilization !== undefined && (!Number.isFinite(overrides.coefficientOfUtilization) || overrides.coefficientOfUtilization <= 0 || overrides.coefficientOfUtilization > 1.0)) {
		errors.push(`Invalid coefficientOfUtilization: ${overrides.coefficientOfUtilization} (must be finite (0, 1])`);
	}
	if (overrides.lightLossFactor !== undefined && (!Number.isFinite(overrides.lightLossFactor) || overrides.lightLossFactor <= 0 || overrides.lightLossFactor > 1.0)) {
		errors.push(`Invalid lightLossFactor: ${overrides.lightLossFactor} (must be finite (0, 1])`);
	}
	if (overrides.defaultLuminaireFluxLm !== undefined && (!Number.isFinite(overrides.defaultLuminaireFluxLm) || overrides.defaultLuminaireFluxLm <= 0)) {
		errors.push(`Invalid defaultLuminaireFluxLm: ${overrides.defaultLuminaireFluxLm} (must be positive finite number)`);
	}
	if (overrides.acSafetyMargin !== undefined && (!Number.isFinite(overrides.acSafetyMargin) || overrides.acSafetyMargin < 0 || overrides.acSafetyMargin > 2.0)) {
		errors.push(`Invalid acSafetyMargin: ${overrides.acSafetyMargin} (must be non-negative [0, 2.0])`);
	}
	if (overrides.defaultWallUValue !== undefined && (!Number.isFinite(overrides.defaultWallUValue) || overrides.defaultWallUValue < 0)) {
		errors.push(`Invalid defaultWallUValue: ${overrides.defaultWallUValue} (must be non-negative finite number)`);
	}
	if (overrides.defaultGlazingUValue !== undefined && (!Number.isFinite(overrides.defaultGlazingUValue) || overrides.defaultGlazingUValue < 0)) {
		errors.push(`Invalid defaultGlazingUValue: ${overrides.defaultGlazingUValue} (must be non-negative finite number)`);
	}
	if (overrides.wwrOverride !== undefined && (!Number.isFinite(overrides.wwrOverride) || overrides.wwrOverride < 0 || overrides.wwrOverride > 1.0)) {
		errors.push(`Invalid wwrOverride: ${overrides.wwrOverride} (must be finite ratio [0, 1])`);
	}
	if (overrides.occupancyMultiplier !== undefined && (!Number.isFinite(overrides.occupancyMultiplier) || overrides.occupancyMultiplier < 0)) {
		errors.push(`Invalid occupancyMultiplier: ${overrides.occupancyMultiplier} (must be non-negative finite number)`);
	}
	if (overrides.wallUValueMultiplier !== undefined && (!Number.isFinite(overrides.wallUValueMultiplier) || overrides.wallUValueMultiplier < 0)) {
		errors.push(`Invalid wallUValueMultiplier: ${overrides.wallUValueMultiplier} (must be non-negative finite number)`);
	}
	if (overrides.glazingUValueMultiplier !== undefined && (!Number.isFinite(overrides.glazingUValueMultiplier) || overrides.glazingUValueMultiplier < 0)) {
		errors.push(`Invalid glazingUValueMultiplier: ${overrides.glazingUValueMultiplier} (must be non-negative finite number)`);
	}
	if (overrides.shadingCoefficientMultiplier !== undefined && (!Number.isFinite(overrides.shadingCoefficientMultiplier) || overrides.shadingCoefficientMultiplier < 0)) {
		errors.push(`Invalid shadingCoefficientMultiplier: ${overrides.shadingCoefficientMultiplier} (must be non-negative finite number)`);
	}
	if (overrides.solarFactorMultiplier !== undefined && (!Number.isFinite(overrides.solarFactorMultiplier) || overrides.solarFactorMultiplier < 0)) {
		errors.push(`Invalid solarFactorMultiplier: ${overrides.solarFactorMultiplier} (must be non-negative finite number)`);
	}
	if (overrides.windowAreaMultiplier !== undefined && (!Number.isFinite(overrides.windowAreaMultiplier) || overrides.windowAreaMultiplier < 0)) {
		errors.push(`Invalid windowAreaMultiplier: ${overrides.windowAreaMultiplier} (must be non-negative finite number)`);
	}

	return {
		isValid: errors.length === 0,
		errors
	};
}

/**
 * Runs the building analysis pipeline under a specific scenario without mutating baseline geometry or inputs.
 */
export function runScenarioAnalysis(
	scenario: DesignScenario,
	detectedRooms: DetectedRoom[],
	topology: RoomTopologyGraph,
	semantics: RoomSemanticInference[],
	baseConfigOverrides?: Partial<RoomAnalysisConfiguration>
): BuildingAnalysisResult {
	const validation = validateScenarioOverrides(scenario.overrides);
	if (!validation.isValid) {
		throw new Error(`Scenario validation failed for "${scenario.name}": ${validation.errors.join('; ')}`);
	}

	// Merge configurations: base defaults -> baseOverrides -> scenario overrides (only RoomAnalysisConfiguration keys)
	const mergedConfig: RoomAnalysisConfiguration = {
		...DEFAULT_ANALYSIS_CONFIGURATION,
		...(baseConfigOverrides || {}),
		...extractBaseConfigurationKeys(scenario.overrides)
	};

	// 1. Build initial standard inputs via adapter
	const rawInputs = buildRoomAnalysisInputs(detectedRooms, topology, semantics, mergedConfig);

	// 2. Apply scenario-specific room, opening, and envelope overrides immutably
	const overriddenInputs: RoomAnalysisInput[] = rawInputs.map((input) => {
		const clone: RoomAnalysisInput = {
			...input,
			geometry: { ...input.geometry, boundingBox: { min: { ...input.geometry.boundingBox.min }, max: { ...input.geometry.boundingBox.max } }, centroid: { ...input.geometry.centroid } },
			openings: input.openings.map((o) => ({ ...o })),
			envelopeSurfaces: input.envelopeSurfaces.map((s) => ({
				...s,
				uValue: { ...s.uValue, source: [...s.uValue.source] },
				solarAbsorptance: { ...s.solarAbsorptance, source: [...s.solarAbsorptance.source] },
				shadingCoefficient: { ...s.shadingCoefficient, source: [...s.shadingCoefficient.source] },
				solarFactor: { ...s.solarFactor, source: [...s.solarFactor.source] }
			})),
			components: input.components.map((c) => ({ ...c })),
			assumptions: {
				...input.assumptions,
				usageProfile: { ...input.assumptions.usageProfile },
				occupantCount: { ...input.assumptions.occupantCount, source: [...input.assumptions.occupantCount.source] }
			}
		};

		// Room function override
		if (scenario.overrides.roomFunctionOverrides && scenario.overrides.roomFunctionOverrides[clone.room.id]) {
			const newFunction = scenario.overrides.roomFunctionOverrides[clone.room.id];
			const newProfile = getRoomUsageProfile(newFunction);
			clone.assumptions.usageProfile = { ...newProfile };
			if (clone.semantic) {
				clone.semantic = { ...clone.semantic, primaryFunction: newFunction };
			}
			// Recompute default occupancy if function changes
			if (newProfile.typicalOccupancyAreaPerPersonM2 > 0) {
				const occ = Math.max(1, Math.round(clone.geometry.floorArea / newProfile.typicalOccupancyAreaPerPersonM2));
				clone.assumptions.occupantCount.value = occ;
				clone.assumptions.occupantCount.source.push('user_config');
			}
		}

		// Room occupancy override (exact count or multiplier)
		if (scenario.overrides.roomOccupancyOverrides && scenario.overrides.roomOccupancyOverrides[clone.room.id] !== undefined) {
			clone.assumptions.occupantCount.value = Math.max(0, scenario.overrides.roomOccupancyOverrides[clone.room.id]);
			clone.assumptions.occupantCount.source.push('user_config');
		} else if (scenario.overrides.occupancyMultiplier !== undefined && clone.assumptions.occupantCount.value !== undefined) {
			clone.assumptions.occupantCount.value = Math.max(0, Math.round(clone.assumptions.occupantCount.value * scenario.overrides.occupancyMultiplier));
			clone.assumptions.occupantCount.source.push('user_config');
		}

		// HVAC conditioned override
		if (scenario.overrides.isHVACConditionedOverride !== undefined) {
			clone.assumptions.usageProfile.thermalComfortMethodEligibility = scenario.overrides.isHVACConditionedOverride ? 'mechanical' : 'adaptive';
		}

		// Window area multiplier or WWR override on exterior window openings
		if (scenario.overrides.windowAreaMultiplier !== undefined || scenario.overrides.wwrOverride !== undefined) {
			for (const opening of clone.openings) {
				if (opening.isExterior && opening.type === 'window') {
					if (scenario.overrides.windowAreaMultiplier !== undefined) {
						opening.area = Math.max(0, opening.area * scenario.overrides.windowAreaMultiplier);
					}
					if (scenario.overrides.wwrOverride !== undefined) {
						// Scale window area towards the target WWR proportion of the wall
						const wallArea = clone.geometry.height * opening.width;
						if (wallArea > 0) {
							opening.area = Math.min(wallArea, wallArea * scenario.overrides.wwrOverride);
						}
					}
				}
			}
		}

		// Envelope multipliers
		for (const surface of clone.envelopeSurfaces) {
			if (surface.role === 'exterior_wall' && scenario.overrides.wallUValueMultiplier !== undefined && surface.uValue.value !== undefined) {
				surface.uValue.value = Math.max(0, surface.uValue.value * scenario.overrides.wallUValueMultiplier);
				surface.uValue.source.push('user_config');
			}
			if (surface.role === 'exterior_wall' || surface.role === 'roof') {
				if (scenario.overrides.shadingCoefficientMultiplier !== undefined && surface.shadingCoefficient.value !== undefined) {
					surface.shadingCoefficient.value = Math.max(0, Math.min(1.0, surface.shadingCoefficient.value * scenario.overrides.shadingCoefficientMultiplier));
					surface.shadingCoefficient.source.push('user_config');
				}
				if (scenario.overrides.solarFactorMultiplier !== undefined && surface.solarFactor.value !== undefined) {
					surface.solarFactor.value = Math.max(0, Math.min(1.0, surface.solarFactor.value * scenario.overrides.solarFactorMultiplier));
					surface.solarFactor.source.push('user_config');
				}
			}
		}

		return clone;
	});

	// 3. Execute core analysis modules on overridden inputs
	const rooms: RoomAnalysisResult[] = overriddenInputs.map((input) => {
		const thermalComfort = calculateThermalComfort(input, mergedConfig);
		const humanFlow = calculateHumanFlow(input, overriddenInputs, topology);
		const naturalVentilation = calculateNaturalVentilation(input, mergedConfig);
		const coolingCapacity = calculateCoolingCapacity(input, mergedConfig);
		const illuminanceRequirement = calculateIlluminanceRequirement(input);
		const requiredLux = illuminanceRequirement.targetLux.value || 200;
		const artificialLighting = calculateArtificialLighting(input, mergedConfig, requiredLux);

		const diagnostics: RoomAnalysisResult['diagnostics'] = [];
		if (thermalComfort.status === 'insufficient_data') {
			diagnostics.push({ module: 'thermal', severity: 'warning', message: 'Insufficient environmental data for thermal comfort' });
		}
		if (humanFlow.accessibilityStatus === 'isolated' || humanFlow.accessibilityStatus === 'unreachable') {
			diagnostics.push({ module: 'flow', severity: 'warning', message: `Room is ${humanFlow.accessibilityStatus}` });
		}
		if (input.dataQuality === 'insufficient') {
			diagnostics.push({ module: 'adapter', severity: 'error', message: 'Room geometry inputs insufficient for reliable analysis' });
		}

		return {
			roomId: input.room.id,
			storeyId: input.room.storeyId,
			thermalComfort,
			humanFlow,
			naturalVentilation,
			coolingCapacity,
			artificialLighting,
			illuminanceRequirement,
			diagnostics,
			dataQuality: input.dataQuality
		};
	});

	const ottv = calculateBuildingOttv(overriddenInputs, mergedConfig);

	// 4. Assemble building summary
	const totalRooms = detectedRooms.length;
	const analyzedRooms = rooms.filter((r) => r.dataQuality !== 'insufficient').length;
	const totalGrossFloorAreaM2 = Math.round(detectedRooms.reduce((sum, r) => sum + r.floorArea, 0) * 10) / 10;
	const totalEstimatedCoolingCapacityKw = Math.round(rooms.reduce((sum, r) => sum + (r.coolingCapacity.recommendedCapacityKw.value || 0), 0) * 100) / 100;
	const totalEstimatedCoolingCapacityPk = Math.round(rooms.reduce((sum, r) => sum + (r.coolingCapacity.recommendedCapacityPk.value || 0), 0) * 10) / 10;
	const totalEstimatedLuminaires = rooms.reduce((sum, r) => sum + (r.artificialLighting.roundedUpCount.value || 0), 0);

	const ventCounts: Record<string, number> = {};
	for (const r of rooms) {
		const vt = r.naturalVentilation.type;
		ventCounts[vt] = (ventCounts[vt] || 0) + 1;
	}
	let predominantVentilationType = 'single_sided';
	let maxCount = 0;
	for (const [vt, count] of Object.entries(ventCounts)) {
		if (count > maxCount) {
			maxCount = count;
			predominantVentilationType = vt;
		}
	}

	const comfortableCount = rooms.filter((r) => r.thermalComfort.status === 'comfortable').length;
	const thermalComfortComplianceRate = analyzedRooms > 0 ? Math.round((comfortableCount / analyzedRooms) * 100) / 100 : 0;

	const summary = {
		totalRooms,
		analyzedRooms,
		totalGrossFloorAreaM2,
		totalEstimatedCoolingCapacityKw,
		totalEstimatedCoolingCapacityPk,
		totalEstimatedLuminaires,
		predominantVentilationType,
		thermalComfortComplianceRate
	};

	const buildingDiagnostics = [];
	if (ottv.isCompliant.value === false) {
		buildingDiagnostics.push({
			category: 'OTTV_COMPLIANCE',
			message: `Building OTTV (${ottv.buildingOttvWm2.value} W/m²) exceeds threshold of ${mergedConfig.ottvThresholdWm2} W/m²`
		});
	}

	return {
		rooms,
		ottv,
		summary,
		diagnostics: buildingDiagnostics,
		configuration: mergedConfig
	};
}

function extractBaseConfigurationKeys(overrides: DesignScenarioOverrides): Partial<RoomAnalysisConfiguration> {
	const keys: (keyof RoomAnalysisConfiguration)[] = [
		'indoorDesignTempC',
		'outdoorDesignTempC',
		'relativeHumidityPercent',
		'localWindSpeedMs',
		'localWindDirectionDeg',
		'projectNorthDeg',
		'defaultLuminaireFluxLm',
		'defaultLuminaireWattageW',
		'coefficientOfUtilization',
		'lightLossFactor',
		'acSafetyMargin',
		'defaultWallUValue',
		'defaultGlazingUValue',
		'defaultSolarFactor',
		'defaultShadingCoefficient',
		'defaultSolarAbsorptance',
		'ottvThresholdWm2'
	];
	const res: Partial<RoomAnalysisConfiguration> = {};
	for (const key of keys) {
		if (overrides[key] !== undefined) {
			(res as any)[key] = overrides[key];
		}
	}
	return res;
}

// ─── Comparison Engine ────────────────────────────────────────────────────────

export type DeltaStatus = 'improved' | 'degraded' | 'unchanged' | 'not_applicable';

export type MetricDelta<T = number> = {
	baselineValue: T | undefined;
	proposedValue: T | undefined;
	absoluteDifference: number;
	percentageDifference: number;
	status: DeltaStatus;
	unit: string;
};

export type RoomComparisonResult = {
	roomId: string;
	storeyId: string;
	roomName?: string;
	status: 'comparable' | 'missing_in_proposed' | 'missing_in_baseline';
	thermalComfortStatusChange: {
		baselineStatus?: 'comfortable' | 'warm' | 'cool' | 'insufficient_data';
		proposedStatus?: 'comfortable' | 'warm' | 'cool' | 'insufficient_data';
		status: DeltaStatus;
	};
	operativeTempDelta: MetricDelta;
	pmvDelta: MetricDelta;
	airflowAchDelta: MetricDelta;
	coolingCapacityWDelta: MetricDelta;
	coolingCapacityPkDelta: MetricDelta;
	targetLuxDelta: MetricDelta;
	luminaireCountDelta: MetricDelta;
	humanFlowScoreDelta: MetricDelta;
};

export type BuildingComparisonResult = {
	baselineScenarioId: string;
	proposedScenarioId: string;
	baselineConfiguration: RoomAnalysisConfiguration;
	proposedConfiguration: RoomAnalysisConfiguration;
	rooms: RoomComparisonResult[];
	missingRooms: {
		missingInProposed: string[];
		missingInBaseline: string[];
	};
	buildingSummaryDelta: {
		totalGrossFloorAreaM2Delta: MetricDelta;
		totalEstimatedCoolingCapacityKwDelta: MetricDelta;
		totalEstimatedCoolingCapacityPkDelta: MetricDelta;
		totalEstimatedLuminairesDelta: MetricDelta;
		thermalComfortComplianceRateDelta: MetricDelta;
	};
	ottvDelta: {
		buildingOttvWm2Delta: MetricDelta;
		isCompliantChange: {
			baselineCompliant?: boolean;
			proposedCompliant?: boolean;
			status: DeltaStatus;
		};
		facades: Array<{
			orientationName: string;
			facadeOttvWm2Delta: MetricDelta;
			wwrDelta: MetricDelta;
		}>;
	};
	diagnostics: string[];
};

function computeMetricDelta(
	baselineVal: number | undefined,
	proposedVal: number | undefined,
	unit: string,
	direction: 'higher_is_better' | 'lower_is_better'
): MetricDelta {
	if (baselineVal === undefined || proposedVal === undefined || !Number.isFinite(baselineVal) || !Number.isFinite(proposedVal)) {
		return {
			baselineValue: baselineVal,
			proposedValue: proposedVal,
			absoluteDifference: 0,
			percentageDifference: 0,
			status: 'not_applicable',
			unit
		};
	}

	const diff = Math.round((proposedVal - baselineVal) * 1000) / 1000;
	if (Math.abs(diff) < 1e-5) {
		return {
			baselineValue: baselineVal,
			proposedValue: proposedVal,
			absoluteDifference: 0,
			percentageDifference: 0,
			status: 'unchanged',
			unit
		};
	}

	const pct = Math.abs(baselineVal) > 1e-6 ? Math.round((diff / Math.abs(baselineVal)) * 10000) / 100 : 0;
	let status: DeltaStatus = 'unchanged';
	if (direction === 'higher_is_better') {
		status = diff > 0 ? 'improved' : 'degraded';
	} else {
		status = diff < 0 ? 'improved' : 'degraded';
	}

	return {
		baselineValue: baselineVal,
		proposedValue: proposedVal,
		absoluteDifference: diff,
		percentageDifference: pct,
		status,
		unit
	};
}

/**
 * Compares two evaluated building analysis results and computes per-room and building deltas.
 */
export function compareScenarios(
	baselineResult: BuildingAnalysisResult,
	proposedResult: BuildingAnalysisResult,
	baselineId = 'baseline',
	proposedId = 'proposed'
): BuildingComparisonResult {
	const missingInProposed: string[] = [];
	const missingInBaseline: string[] = [];
	const roomsComparison: RoomComparisonResult[] = [];

	const baseRoomMap = new Map<string, RoomAnalysisResult>();
	for (const r of baselineResult.rooms) {
		baseRoomMap.set(r.roomId, r);
	}
	const propRoomMap = new Map<string, RoomAnalysisResult>();
	for (const r of proposedResult.rooms) {
		propRoomMap.set(r.roomId, r);
	}

	// Match rooms
	for (const [roomId, baseRoom] of baseRoomMap.entries()) {
		const propRoom = propRoomMap.get(roomId);
		if (!propRoom) {
			missingInProposed.push(roomId);
			roomsComparison.push({
				roomId,
				storeyId: baseRoom.storeyId,
				roomName: roomId,
				status: 'missing_in_proposed',
				thermalComfortStatusChange: { baselineStatus: baseRoom.thermalComfort.status, status: 'not_applicable' },
				operativeTempDelta: computeMetricDelta(baseRoom.thermalComfort.operativeTempC.value, undefined, '°C', 'lower_is_better'),
				pmvDelta: computeMetricDelta(typeof baseRoom.thermalComfort.predictedValue.value === 'number' ? baseRoom.thermalComfort.predictedValue.value : undefined, undefined, 'PMV', 'lower_is_better'),
				airflowAchDelta: computeMetricDelta(baseRoom.naturalVentilation.estimatedAch.value, undefined, 'ACH', 'higher_is_better'),
				coolingCapacityWDelta: computeMetricDelta(baseRoom.coolingCapacity.recommendedCapacityW.value, undefined, 'W', 'lower_is_better'),
				coolingCapacityPkDelta: computeMetricDelta(baseRoom.coolingCapacity.recommendedCapacityPk.value, undefined, 'PK', 'lower_is_better'),
				targetLuxDelta: computeMetricDelta(baseRoom.illuminanceRequirement.targetLux.value, undefined, 'lux', 'lower_is_better'),
				luminaireCountDelta: computeMetricDelta(baseRoom.artificialLighting.roundedUpCount.value, undefined, 'count', 'lower_is_better'),
				humanFlowScoreDelta: computeMetricDelta(baseRoom.humanFlow.movementScore.value, undefined, 'score', 'higher_is_better')
			});
		} else {
			// Both present -> compute deltas
			let tcStatus: DeltaStatus = 'unchanged';
			if (baseRoom.thermalComfort.status !== propRoom.thermalComfort.status) {
				if (propRoom.thermalComfort.status === 'comfortable') {
					tcStatus = 'improved';
				} else if (baseRoom.thermalComfort.status === 'comfortable') {
					tcStatus = 'degraded';
				} else {
					tcStatus = 'degraded';
				}
			}

			roomsComparison.push({
				roomId,
				storeyId: baseRoom.storeyId,
				roomName: roomId,
				status: 'comparable',
				thermalComfortStatusChange: {
					baselineStatus: baseRoom.thermalComfort.status,
					proposedStatus: propRoom.thermalComfort.status,
					status: tcStatus
				},
				operativeTempDelta: computeMetricDelta(
					baseRoom.thermalComfort.operativeTempC.value,
					propRoom.thermalComfort.operativeTempC.value,
					'°C',
					'lower_is_better'
				),
				pmvDelta: computeMetricDelta(
					typeof baseRoom.thermalComfort.predictedValue.value === 'number' ? baseRoom.thermalComfort.predictedValue.value : undefined,
					typeof propRoom.thermalComfort.predictedValue.value === 'number' ? propRoom.thermalComfort.predictedValue.value : undefined,
					'PMV',
					'lower_is_better'
				),
				airflowAchDelta: computeMetricDelta(
					baseRoom.naturalVentilation.estimatedAch.value,
					propRoom.naturalVentilation.estimatedAch.value,
					'ACH',
					'higher_is_better'
				),
				coolingCapacityWDelta: computeMetricDelta(
					baseRoom.coolingCapacity.recommendedCapacityW.value,
					propRoom.coolingCapacity.recommendedCapacityW.value,
					'W',
					'lower_is_better'
				),
				coolingCapacityPkDelta: computeMetricDelta(
					baseRoom.coolingCapacity.recommendedCapacityPk.value,
					propRoom.coolingCapacity.recommendedCapacityPk.value,
					'PK',
					'lower_is_better'
				),
				targetLuxDelta: computeMetricDelta(
					baseRoom.illuminanceRequirement.targetLux.value,
					propRoom.illuminanceRequirement.targetLux.value,
					'lux',
					'higher_is_better'
				),
				luminaireCountDelta: computeMetricDelta(
					baseRoom.artificialLighting.roundedUpCount.value,
					propRoom.artificialLighting.roundedUpCount.value,
					'count',
					'lower_is_better'
				),
				humanFlowScoreDelta: computeMetricDelta(
					baseRoom.humanFlow.movementScore.value,
					propRoom.humanFlow.movementScore.value,
					'score',
					'higher_is_better'
				)
			});
		}
	}

	for (const [roomId, propRoom] of propRoomMap.entries()) {
		if (!baseRoomMap.has(roomId)) {
			missingInBaseline.push(roomId);
			roomsComparison.push({
				roomId,
				storeyId: propRoom.storeyId,
				roomName: roomId,
				status: 'missing_in_baseline',
				thermalComfortStatusChange: { proposedStatus: propRoom.thermalComfort.status, status: 'not_applicable' },
				operativeTempDelta: computeMetricDelta(undefined, propRoom.thermalComfort.operativeTempC.value, '°C', 'lower_is_better'),
				pmvDelta: computeMetricDelta(undefined, typeof propRoom.thermalComfort.predictedValue.value === 'number' ? propRoom.thermalComfort.predictedValue.value : undefined, 'PMV', 'lower_is_better'),
				airflowAchDelta: computeMetricDelta(undefined, propRoom.naturalVentilation.estimatedAch.value, 'ACH', 'higher_is_better'),
				coolingCapacityWDelta: computeMetricDelta(undefined, propRoom.coolingCapacity.recommendedCapacityW.value, 'W', 'lower_is_better'),
				coolingCapacityPkDelta: computeMetricDelta(undefined, propRoom.coolingCapacity.recommendedCapacityPk.value, 'PK', 'lower_is_better'),
				targetLuxDelta: computeMetricDelta(undefined, propRoom.illuminanceRequirement.targetLux.value, 'lux', 'higher_is_better'),
				luminaireCountDelta: computeMetricDelta(undefined, propRoom.artificialLighting.roundedUpCount.value, 'count', 'lower_is_better'),
				humanFlowScoreDelta: computeMetricDelta(undefined, propRoom.humanFlow.movementScore.value, 'score', 'higher_is_better')
			});
		}
	}

	// Building summary delta
	const buildingSummaryDelta = {
		totalGrossFloorAreaM2Delta: computeMetricDelta(
			baselineResult.summary.totalGrossFloorAreaM2,
			proposedResult.summary.totalGrossFloorAreaM2,
			'm²',
			'higher_is_better'
		),
		totalEstimatedCoolingCapacityKwDelta: computeMetricDelta(
			baselineResult.summary.totalEstimatedCoolingCapacityKw,
			proposedResult.summary.totalEstimatedCoolingCapacityKw,
			'kW',
			'lower_is_better'
		),
		totalEstimatedCoolingCapacityPkDelta: computeMetricDelta(
			baselineResult.summary.totalEstimatedCoolingCapacityPk,
			proposedResult.summary.totalEstimatedCoolingCapacityPk,
			'PK',
			'lower_is_better'
		),
		totalEstimatedLuminairesDelta: computeMetricDelta(
			baselineResult.summary.totalEstimatedLuminaires,
			proposedResult.summary.totalEstimatedLuminaires,
			'count',
			'lower_is_better'
		),
		thermalComfortComplianceRateDelta: computeMetricDelta(
			baselineResult.summary.thermalComfortComplianceRate,
			proposedResult.summary.thermalComfortComplianceRate,
			'%',
			'higher_is_better'
		)
	};

	// OTTV delta
	let complianceStatus: DeltaStatus = 'unchanged';
	if (baselineResult.ottv.isCompliant.value !== proposedResult.ottv.isCompliant.value) {
		complianceStatus = proposedResult.ottv.isCompliant.value ? 'improved' : 'degraded';
	}

	const baseFacadesMap = new Map(baselineResult.ottv.facades.map((f) => [f.orientationName, f]));
	const propFacadesMap = new Map(proposedResult.ottv.facades.map((f) => [f.orientationName, f]));
	const allOridents = new Set([...baseFacadesMap.keys(), ...propFacadesMap.keys()]);

	const facadesDelta = Array.from(allOridents).map((orient) => {
		const bf = baseFacadesMap.get(orient);
		const pf = propFacadesMap.get(orient);
		return {
			orientationName: orient,
			facadeOttvWm2Delta: computeMetricDelta(bf?.facadeOttvWm2, pf?.facadeOttvWm2, 'W/m²', 'lower_is_better'),
			wwrDelta: computeMetricDelta(bf?.wwr, pf?.wwr, 'ratio (0-1)', 'lower_is_better')
		};
	});

	const ottvDelta = {
		buildingOttvWm2Delta: computeMetricDelta(
			baselineResult.ottv.buildingOttvWm2.value,
			proposedResult.ottv.buildingOttvWm2.value,
			'W/m²',
			'lower_is_better'
		),
		isCompliantChange: {
			baselineCompliant: baselineResult.ottv.isCompliant.value,
			proposedCompliant: proposedResult.ottv.isCompliant.value,
			status: complianceStatus
		},
		facades: facadesDelta
	};

	const diagnostics: string[] = [];
	if (missingInProposed.length > 0) {
		diagnostics.push(`Proposed scenario missing ${missingInProposed.length} room(s) present in baseline: ${missingInProposed.join(', ')}`);
	}
	if (missingInBaseline.length > 0) {
		diagnostics.push(`Proposed scenario added ${missingInBaseline.length} room(s) not in baseline: ${missingInBaseline.join(', ')}`);
	}

	return {
		baselineScenarioId: baselineId,
		proposedScenarioId: proposedId,
		baselineConfiguration: baselineResult.configuration,
		proposedConfiguration: proposedResult.configuration,
		rooms: roomsComparison,
		missingRooms: {
			missingInProposed,
			missingInBaseline
		},
		buildingSummaryDelta,
		ottvDelta,
		diagnostics
	};
}
