/**
 * types.ts
 *
 * Central contracts for Task 3C: Room and Building Performance Analysis.
 * Connects DetectedRoom, RoomTopologyGraph, and RoomSemanticInference to:
 * 1. Thermal comfort
 * 2. Human movement and spatial flow
 * 3. Natural ventilation and airflow direction
 * 4. AC cooling-capacity estimation
 * 5. Artificial-light point calculation
 * 6. OTTV
 * 7. Required room illuminance
 */

import type { DetectedRoom, Point3D } from '../detected-room';
import type { PlanCoord } from '../types';
import type { RoomTopologyNode, RoomTopologyGraph } from '../topology';
import type { RoomSemanticInference, RoomFunction } from '../semantics';

// ─── Provenance & Quality Contracts ───────────────────────────────────────────

export type AnalysisInputSource =
	| 'model'
	| 'room_inference'
	| 'user_config'
	| 'standard_profile'
	| 'fallback_assumption';

export type AnalysisValueState =
	| 'calculated'
	| 'estimated'
	| 'assumption_dependent'
	| 'insufficient_data'
	| 'not_applicable';

export type AnalysisValue<T> = {
	value?: T;
	state: AnalysisValueState;
	source: AnalysisInputSource[];
	confidence: number;
	diagnostics: string[];
};

export type RoomAnalysisDataQuality = 'complete' | 'partial' | 'insufficient';

// ─── Configuration & Profiles ─────────────────────────────────────────────────

export type RoomAnalysisConfiguration = {
	indoorDesignTempC: number;
	outdoorDesignTempC: number;
	relativeHumidityPercent: number;
	localWindSpeedMs: number;
	localWindDirectionDeg: number; // 0 = North, 90 = East, 180 = South, 270 = West
	projectNorthDeg: number | null; // null if unresolved
	defaultLuminaireFluxLm: number;
	defaultLuminaireWattageW: number;
	coefficientOfUtilization: number;
	lightLossFactor: number;
	acSafetyMargin: number; // e.g. 0.15 for 15%
	defaultWallUValue: number; // W/m²·K
	defaultGlazingUValue: number; // W/m²·K
	defaultSolarFactor: number; // SF / SHGC equivalent
	defaultShadingCoefficient: number;
	defaultSolarAbsorptance: number; // alpha
	ottvThresholdWm2: number; // e.g. 35 W/m²
};

export const DEFAULT_ANALYSIS_CONFIGURATION: RoomAnalysisConfiguration = {
	indoorDesignTempC: 24.0,
	outdoorDesignTempC: 32.0,
	relativeHumidityPercent: 60.0,
	localWindSpeedMs: 2.5,
	localWindDirectionDeg: 180.0, // South prevailing
	projectNorthDeg: 0.0,
	defaultLuminaireFluxLm: 3200.0,
	defaultLuminaireWattageW: 36.0,
	coefficientOfUtilization: 0.65,
	lightLossFactor: 0.80,
	acSafetyMargin: 0.15,
	defaultWallUValue: 2.8, // standard masonry
	defaultGlazingUValue: 5.8, // single clear glass
	defaultSolarFactor: 0.70,
	defaultShadingCoefficient: 0.81,
	defaultSolarAbsorptance: 0.60,
	ottvThresholdWm2: 35.0
};

export type RoomUsageProfile = {
	function: RoomFunction;
	targetIlluminanceLux: number;
	workPlaneHeightM: number;
	typicalOccupancyAreaPerPersonM2: number;
	sensibleHeatPerPersonW: number;
	latentHeatPerPersonW: number;
	equipmentLoadDensityWm2: number;
	lightingPowerDensityWm2: number;
	metabolicRateMet: number;
	clothingInsulationClo: number;
	ventilationAchExpectation: number;
	thermalComfortMethodEligibility: 'mechanical' | 'adaptive' | 'both';
};

// ─── Input Adapter Sub-Structures ─────────────────────────────────────────────

export type RoomGeometryAnalysisInput = {
	floorArea: number;
	perimeter: number;
	height: number;
	volume: number;
	centroid: Point3D;
	boundingBox: { min: Point3D; max: Point3D };
	aspectRatio: number;
	minWidth: number;
};

export type RoomOpeningAnalysisInput = {
	id: string;
	type: 'door' | 'window' | 'open_passage' | 'unknown';
	area: number;
	width: number;
	height: number;
	sillElevation: number;
	headElevation: number;
	isExterior: boolean;
	orientationDeg?: number; // world orientation in degrees (0 = North)
	connectedRoomId?: string;
};

export type RoomEnvelopeSurfaceInput = {
	id: string;
	role: 'exterior_wall' | 'interior_wall' | 'floor' | 'ceiling' | 'roof';
	area: number;
	orientationDeg?: number; // 0 = N, 90 = E, 180 = S, 270 = W
	materialId?: string;
	uValue: AnalysisValue<number>;
	solarAbsorptance: AnalysisValue<number>;
	shadingCoefficient: AnalysisValue<number>;
	solarFactor: AnalysisValue<number>;
};

export type RoomComponentEvidence = {
	id: string;
	category: string;
	name?: string;
	count: number;
	assumedLoadW?: number;
};

export type RoomAnalysisAssumptions = {
	usageProfile: RoomUsageProfile;
	indoorDesignTempC: number;
	outdoorDesignTempC: number;
	relativeHumidityPercent: number;
	airSpeedMs: number;
	clothingClo: number;
	metabolicRateMet: number;
	localWindSpeedMs: number;
	localWindDirectionDeg: number;
	occupantCount: AnalysisValue<number>;
};

export type RoomAnalysisInput = {
	room: DetectedRoom;
	topologyNode?: RoomTopologyNode;
	semantic?: RoomSemanticInference;
	geometry: RoomGeometryAnalysisInput;
	openings: RoomOpeningAnalysisInput[];
	envelopeSurfaces: RoomEnvelopeSurfaceInput[];
	components: RoomComponentEvidence[];
	assumptions: RoomAnalysisAssumptions;
	dataQuality: RoomAnalysisDataQuality;
};

export type CalculationTraceInput = {
	name: string;
	value: number | string | boolean | null | undefined;
	unit: string;
};

export type CalculationTraceIntermediate = {
	name: string;
	value: number | string | boolean | null | undefined;
	unit: string;
};

export type CalculationTrace = {
	method: string;
	formula: string;
	inputs: CalculationTraceInput[];
	intermediateValues: CalculationTraceIntermediate[];
	assumptions: string[];
	finalResult: {
		value: number | string | boolean | null | undefined;
		unit: string;
	};
	confidence: number;
	warnings: string[];
};

// ─── Analysis Module Results ──────────────────────────────────────────────────

export type ThermalComfortResult = {
	method: 'mechanical_pmv_ppd' | 'natural_adaptive' | 'unresolved';
	operativeTempC: AnalysisValue<number>;
	predictedValue: AnalysisValue<number | string>; // PMV (-3 to +3) or Adaptive limits ("22.5 - 29.5 °C")
	ppdPercent?: AnalysisValue<number>;
	status: 'comfortable' | 'warm' | 'cool' | 'insufficient_data';
	missingInputs: string[];
	assumptions: string[];
	confidence: number;
	trace?: CalculationTrace;
};

export type HumanFlowResult = {
	connectionDegree: number;
	accessibleNeighborCount: number;
	circulationLikelihood: AnalysisValue<number>; // 0 to 1
	isDeadEnd: boolean;
	isIsolated: boolean;
	entranceCount: number;
	estimatedCirculationWidthM?: AnalysisValue<number>;
	connectedComponentId: number;
	shortestPathDistanceToExit?: AnalysisValue<number>;
	isDecisionPoint: boolean;
	movementScore: AnalysisValue<number>; // 0 to 100
	accessibilityStatus: 'accessible' | 'dead_end' | 'isolated' | 'unreachable';
	majorConstraints: string[];
	evidence: string[];
	diagnostics: string[];
	trace?: CalculationTrace;
};

export type NaturalVentilationResult = {
	type: 'no_exterior_ventilation' | 'single_sided' | 'cross_ventilation' | 'stack_assisted' | 'unresolved';
	effectiveOpeningAreaM2: AnalysisValue<number>;
	estimatedAirflowRateM3s: AnalysisValue<number>;
	estimatedAch: AnalysisValue<number>;
	windwardRelationship: 'windward' | 'leeward' | 'parallel' | 'sheltered' | 'unknown';
	airflowDirectionDeg?: AnalysisValue<number>;
	confidence: number;
	methodIdentifier: string;
	missingInputs: string[];
	assumptions: string[];
	trace?: CalculationTrace;
};

export type CoolingLoadBreakdown = {
	envelopeConductiveW: AnalysisValue<number>;
	glazingConductiveW: AnalysisValue<number>;
	solarGlazingW: AnalysisValue<number>;
	occupantSensibleW: AnalysisValue<number>;
	occupantLatentW: AnalysisValue<number>;
	lightingW: AnalysisValue<number>;
	equipmentW: AnalysisValue<number>;
	ventilationInfiltrationW: AnalysisValue<number>;
};

export type CoolingCapacityResult = {
	methodIdentifier: string;
	breakdown: CoolingLoadBreakdown;
	totalSensibleW: AnalysisValue<number>;
	totalLatentW: AnalysisValue<number>;
	totalCoolingLoadW: AnalysisValue<number>;
	recommendedCapacityW: AnalysisValue<number>;
	recommendedCapacityKw: AnalysisValue<number>;
	recommendedCapacityBtuh: AnalysisValue<number>;
	recommendedCapacityPk: AnalysisValue<number>; // Nominal PK (~9000 BTU/h per PK)
	missingInputs: string[];
	assumptions: string[];
	trace?: CalculationTrace;
};

export type IlluminanceRequirementResult = {
	targetLux: AnalysisValue<number>;
	sourceProfile: string;
	semanticConfidence: number;
	workPlaneHeightM: number;
	applicability: 'direct_match' | 'uncertain_fallback' | 'generic_default';
	alternatives: { function: RoomFunction; targetLux: number }[];
	trace?: CalculationTrace;
};

export type LuminairePoint3D = {
	id: string;
	position: Point3D;
	isValidInsidePolygon: boolean;
};

export type ArtificialLightingResult = {
	methodIdentifier: string;
	rawCalculatedCount: AnalysisValue<number>;
	roundedUpCount: AnalysisValue<number>;
	targetLux: number;
	estimatedAchievedLux: AnalysisValue<number>;
	luminousFluxLm: number;
	coefficientOfUtilization: number;
	lightLossFactor: number;
	proposedGrid: {
		rows: number;
		columns: number;
		spacingXM: number;
		spacingZM: number;
	};
	mountingHeightM: number;
	workPlaneHeightM: number;
	proposedPositions: LuminairePoint3D[];
	assumptions: string[];
	limitations: string[];
	trace?: CalculationTrace;
};

export type RoomAnalysisDiagnostic = {
	module: 'thermal' | 'flow' | 'ventilation' | 'cooling' | 'illuminance' | 'lighting' | 'ottv' | 'adapter';
	severity: 'info' | 'warning' | 'error';
	message: string;
};

export type RoomAnalysisResult = {
	roomId: string;
	storeyId: string;
	thermalComfort: ThermalComfortResult;
	humanFlow: HumanFlowResult;
	naturalVentilation: NaturalVentilationResult;
	coolingCapacity: CoolingCapacityResult;
	artificialLighting: ArtificialLightingResult;
	illuminanceRequirement: IlluminanceRequirementResult;
	diagnostics: RoomAnalysisDiagnostic[];
	dataQuality: RoomAnalysisDataQuality;
};

// ─── Façade & Building Level OTTV & Summary ───────────────────────────────────

export type FacadeOrientationGroup = {
	orientationName: 'North' | 'East' | 'South' | 'West' | 'Northeast' | 'Southeast' | 'Southwest' | 'Northwest' | 'Horizontal/Roof';
	azimuthDeg: number;
	totalOpaqueAreaM2: number;
	totalGlazingAreaM2: number;
	wwr: number;
	areaWeightedWallUValue: number;
	areaWeightedGlazingUValue: number;
	areaWeightedSolarFactor: number;
	areaWeightedShadingCoefficient: number;
	areaWeightedSolarAbsorptance: number;
	opaqueConductionContributionWm2: number;
	glazingConductionContributionWm2: number;
	solarFenestrationContributionWm2: number;
	facadeOttvWm2: number;
	adjacentRoomIds: string[];
	trace?: CalculationTrace;
};

export type BuildingOttvResult = {
	facades: FacadeOrientationGroup[];
	buildingOttvWm2: AnalysisValue<number>;
	thresholdWm2: number;
	isCompliant: AnalysisValue<boolean>;
	totalExteriorOpaqueAreaM2: number;
	totalExteriorGlazingAreaM2: number;
	overallWwr: number;
	missingInputs: string[];
	assumptions: string[];
	diagnostics: string[];
	trace?: CalculationTrace;
};

export type BuildingAnalysisSummary = {
	totalRooms: number;
	analyzedRooms: number;
	totalGrossFloorAreaM2: number;
	totalEstimatedCoolingCapacityKw: number;
	totalEstimatedCoolingCapacityPk: number;
	totalEstimatedLuminaires: number;
	predominantVentilationType: string;
	thermalComfortComplianceRate: number;
};

export type BuildingAnalysisDiagnostic = {
	category: string;
	message: string;
	roomIds?: string[];
};

export type BuildingAnalysisResult = {
	rooms: RoomAnalysisResult[];
	ottv: BuildingOttvResult;
	summary: BuildingAnalysisSummary;
	diagnostics: BuildingAnalysisDiagnostic[];
	configuration: RoomAnalysisConfiguration;
};
