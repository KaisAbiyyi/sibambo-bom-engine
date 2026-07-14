/**
 * traces-validation.test.ts
 *
 * Comprehensive unit and numerical stability tests for Task 3D:
 * Numerical Validation, Explicit Units, Calculation Traces, and Real-Model Benchmarking.
 */

import { describe, test, expect } from 'bun:test';
import type { DetectedRoom } from '../detected-room';
import type { RoomTopologyGraph } from '../topology';
import type { RoomSemanticInference } from '../semantics';
import {
	DEFAULT_ANALYSIS_CONFIGURATION,
	buildRoomAnalysisInputs,
	calculateThermalComfort,
	calculateHumanFlow,
	calculateNaturalVentilation,
	calculateCoolingCapacity,
	calculateIlluminanceRequirement,
	calculateArtificialLighting,
	calculateBuildingOttv
} from './index';

function createMockRoom(id: string, floorArea: number, height: number, overrides?: Partial<DetectedRoom>): DetectedRoom {
	const side = Math.sqrt(Math.max(0.1, floorArea));
	return {
		id,
		storeyId: 'storey_1',
		boundary2D: [
			{ x: 0, z: 0 },
			{ x: side, z: 0 },
			{ x: side, z: side },
			{ x: 0, z: side }
		],
		holes2D: [],
		floorElevation: 0,
		ceilingElevation: height,
		height,
		floorArea,
		perimeter: 4 * side,
		estimatedVolume: floorArea * height,
		centroid: { x: side / 2, y: height / 2, z: side / 2 },
		boundingBox: {
			min: { x: 0, y: 0, z: 0 },
			max: { x: side, y: height, z: side }
		},
		planBounds: {
			min: { x: 0, z: 0 },
			max: { x: side, z: side }
		},
		sourceEnvelopeIds: ['env_1'],
		sourceBoundaryIds: ['bnd_1'],
		confidence: { score: 0.9, level: 'high', penalties: [] },
		status: 'valid',
		evidence: {
			sourceLoopId: 'loop_1',
			sourceEnvelopeIds: ['env_1'],
			sourceBoundaryEdgeIds: ['edge_1'],
			boundarySegments: [
				{
					id: `${id}_wall_n`,
					kind: 'wall',
					start: { x: 0, z: side },
					end: { x: side, z: side },
					sourceEvidenceIds: ['ev_1'],
					confidence: 0.9
				}
			],
			hasOpeningBridges: false,
			inferredSegmentCount: 0,
			directSegmentCount: 1,
			directBoundaryFraction: 1.0
		},
		diagnostics: [],
		...overrides
	} as unknown as DetectedRoom;
}

function createMockTopology(rooms: DetectedRoom[], overrides?: Partial<RoomTopologyGraph>): RoomTopologyGraph {
	return {
		rooms: rooms.map((r) => ({
			roomId: r.id,
			storeyId: r.storeyId,
			centroid: r.centroid,
			floorArea: r.floorArea,
			boundaryRoomIds: [],
			connectionIds: [],
			exteriorConnectionIds: []
		})),
		connections: [],
		sharedBoundaries: [],
		exteriorConnections: [
			{
				id: 'ext_win_1',
				openingId: 'win_1',
				roomId: rooms[0]?.id || 'room_trace_1',
				openingType: 'window' as const,
				evidence: {
					openingArea: 5.0,
					normal: { x: 0, y: 0, z: 1 }
				}
			}
		],
		diagnostics: {
			openingsWithoutSupportingWalls: 0,
			openingsAssociatedWithMoreThanTwoRooms: 0,
			adjacentRoomsWithoutSideAssignment: 0,
			duplicateRoomConnections: 0,
			isolatedRooms: 0,
			roomsWithoutAccess: 0,
			overlappingRoomPolygons: 0,
			crossStoreyAdjacencyAttempts: 0,
			unresolvedExteriorFacingBoundaries: 0
		},
		...(overrides || {})
	} as unknown as RoomTopologyGraph;
}

function createMockSemantics(rooms: DetectedRoom[]): RoomSemanticInference[] {
	return rooms.map((r) => ({
		roomId: r.id,
		primaryFunction: 'office' as any,
		confidence: 0.9,
		candidates: [
			{
				function: 'office' as any,
				confidence: 0.9,
				evidence: { geometricScores: {}, topologicalScores: {}, objectScores: {}, tagScores: {}, classificationUnitScores: {}, appliedRules: [] }
			}
		],
		diagnostics: []
	})) as unknown as RoomSemanticInference[];
}

describe('Task 3D — Numerical Validation, Calculation Traces & Explicit Units', () => {
	const room = createMockRoom('room_trace_1', 25, 3.0);
	const topology = createMockTopology([room]);
	const semantics = createMockSemantics([room]);

	const [input] = buildRoomAnalysisInputs([room], topology, semantics, DEFAULT_ANALYSIS_CONFIGURATION);

	test('1. Thermal Comfort calculation trace contains required structure, formulas, explicit units, and assumptions', () => {
		// Test adaptive (unconditioned)
		const result = calculateThermalComfort(input, DEFAULT_ANALYSIS_CONFIGURATION);
		expect(result.trace).toBeDefined();
		const trace = result.trace!;
		expect(trace.method).toContain('Adaptive Comfort');
		expect(trace.formula).toContain('T_neutral =');
		expect(trace.inputs.some((i) => i.unit === '°C')).toBe(true);
		expect(trace.intermediateValues.some((v) => v.name === 'Neutral Temperature')).toBe(true);
		expect(trace.assumptions.length).toBeGreaterThan(0);
		expect(trace.finalResult).toBeDefined();

		// Test mechanical (conditioned)
		const condInput = {
			...input,
			components: [
				{
					id: 'ac_1',
					name: 'AC Split Unit',
					category: 'hvac',
					count: 1,
					confidence: 0.9,
					boundingBox: { min: { x: 0, y: 2, z: 0 }, max: { x: 1, y: 2.5, z: 0.5 } },
					sourceEvidenceIds: []
				}
			],
			assumptions: {
				...input.assumptions,
				isHVACConditioned: true,
				usageProfile: { ...input.assumptions.usageProfile, thermalComfortMethodEligibility: 'mechanical' as const }
			}
		};
		const condResult = calculateThermalComfort(condInput, DEFAULT_ANALYSIS_CONFIGURATION);
		expect(condResult.trace).toBeDefined();
		const condTrace = condResult.trace!;
		expect(condTrace.method).toContain('Mechanical PMV/PPD');
		expect(condTrace.inputs.some((i) => i.unit === '°C')).toBe(true);
		expect(condTrace.inputs.some((i) => i.unit === 'm/s')).toBe(true);
		expect(condTrace.inputs.some((i) => i.unit === 'Clo')).toBe(true);
		expect(condTrace.inputs.some((i) => i.unit === 'Met')).toBe(true);
		expect(condTrace.intermediateValues.some((v) => v.name === 'Operative Temperature')).toBe(true);
		expect(condTrace.finalResult.unit).toContain('PMV');
	});

	test('2. Human Flow calculation trace records occupancy, graph components, and evacuation units', () => {
		const result = calculateHumanFlow(input, [input], topology);
		expect(result.trace).toBeDefined();
		const trace = result.trace!;
		expect(trace.method).toContain('Topological Graph Analysis');
		expect(trace.inputs.some((i) => i.name === 'Floor Area' && i.unit === 'm²')).toBe(true);
		expect(trace.inputs.some((i) => i.name === 'Entrance Count' && i.unit === 'count')).toBe(true);
		expect(trace.intermediateValues.some((v) => v.unit === 'steps')).toBe(true);
		expect(trace.finalResult.unit).toBe('score (0-100)');
	});

	test('3. Natural Ventilation calculation trace specifies ACH and m³/s airflow units explicitly', () => {
		const result = calculateNaturalVentilation(input, DEFAULT_ANALYSIS_CONFIGURATION);
		expect(result.trace).toBeDefined();
		const trace = result.trace!;
		expect(trace.method).toContain('First-Order Opening Balance');
		expect(trace.inputs.some((i) => i.name === 'Room Volume' && i.unit === 'm³')).toBe(true);
		expect(trace.inputs.some((i) => i.name === 'Effective Opening Area' && i.unit === 'm²')).toBe(true);
		expect(trace.intermediateValues.some((v) => v.name === 'Wind-driven Airflow Q_wind' && v.unit === 'm³/s')).toBe(true);
		expect(trace.finalResult.unit).toBe('ACH');
	});

	test('4. Cooling Capacity calculation trace outputs exact components and multi-unit conversions (W, kW, BTU/h, PK)', () => {
		const result = calculateCoolingCapacity(input, DEFAULT_ANALYSIS_CONFIGURATION);
		expect(result.trace).toBeDefined();
		const trace = result.trace!;
		expect(trace.method).toContain('Peak Cooling Load Component Summation');
		expect(trace.inputs.some((i) => i.name === 'Floor Area' && i.unit === 'm²')).toBe(true);
		expect(trace.inputs.some((i) => i.name === 'Occupants' && i.unit === 'people')).toBe(true);
		expect(trace.intermediateValues.some((v) => v.name === 'Total Sensible Load' && v.unit === 'W')).toBe(true);
		expect(trace.intermediateValues.some((v) => v.name === 'Total Latent Load' && v.unit === 'W')).toBe(true);
		expect(trace.intermediateValues.some((v) => v.name === 'Total Cooling Load' && v.unit === 'W')).toBe(true);
		expect(trace.finalResult.unit).toBe('W / kW / BTU/h / PK');
	});

	test('5. Illuminance Requirement calculation trace maps profile target lux and work plane height in meters', () => {
		const result = calculateIlluminanceRequirement(input);
		expect(result.trace).toBeDefined();
		const trace = result.trace!;
		expect(trace.method).toContain('Standard Profile Illuminance Mapping');
		expect(trace.intermediateValues.some((v) => v.name === 'Profile Target Lux' && v.unit === 'lux')).toBe(true);
		expect(trace.intermediateValues.some((v) => v.name === 'Work Plane Height' && v.unit === 'm')).toBe(true);
		expect(trace.finalResult.value).toBe(500); // office target lux
		expect(trace.finalResult.unit).toBe('lux');
	});

	test('6. Artificial Lighting calculation trace records Lumen Method terms and luminaire grid parameters', () => {
		const result = calculateArtificialLighting(input, DEFAULT_ANALYSIS_CONFIGURATION, 500);
		expect(result.trace).toBeDefined();
		const trace = result.trace!;
		expect(trace.method).toContain('Lumen Method');
		expect(trace.inputs.some((i) => i.name === 'Target Illuminance E' && i.unit === 'lux')).toBe(true);
		expect(trace.inputs.some((i) => i.name === 'Coefficient of Utilization CU')).toBe(true);
		expect(trace.inputs.some((i) => i.name === 'Light Loss Factor LLF')).toBe(true);
		expect(trace.intermediateValues.some((v) => v.name === 'Proposed Grid Columns' && v.unit === 'count')).toBe(true);
		expect(trace.finalResult.unit).toBe('count / lux');
	});

	test('7. Building OTTV calculation trace records individual façade contributions and area weighting (W/m²)', () => {
		const result = calculateBuildingOttv([input], DEFAULT_ANALYSIS_CONFIGURATION);
		expect(result.trace).toBeDefined();
		const trace = result.trace!;
		expect(trace.method).toContain('Façade-Area Weighted Building OTTV');
		expect(trace.inputs.some((i) => i.name === 'Total Exterior Façade Area' && i.unit === 'm²')).toBe(true);
		expect(trace.inputs.some((i) => i.name === 'OTTV Threshold' && i.unit === 'W/m²')).toBe(true);
		expect(trace.intermediateValues.length).toBe(result.facades.length);
		if (result.facades.length > 0) {
			expect(result.facades[0].trace).toBeDefined();
			expect(result.facades[0].trace!.formula).toContain('OTTV_facade = alpha * U_w * (1 - WWR)');
		}
	});

	test('8. Numerical stability: non-finite and physically invalid inputs (NaN/Infinity/-1) are rejected/flagged without crashing', () => {
		const invalidRoom = createMockRoom('room_nan', NaN, -5.0);
		const nanTopology = createMockTopology([invalidRoom]);
		const nanSemantics = createMockSemantics([invalidRoom]);
		const [nanInput] = buildRoomAnalysisInputs([invalidRoom], nanTopology, nanSemantics, DEFAULT_ANALYSIS_CONFIGURATION);

		// Thermal Comfort with non-finite temps
		const nanConfig = { ...DEFAULT_ANALYSIS_CONFIGURATION, defaultOutdoorTempC: NaN };
		const tcResult = calculateThermalComfort(nanInput, nanConfig);
		expect(tcResult.status).toBe('insufficient_data');
		expect(tcResult.missingInputs.length).toBeGreaterThan(0);

		// Human flow with non-finite dimensions
		const hfResult = calculateHumanFlow(nanInput, [nanInput], nanTopology);
		expect(hfResult.trace?.warnings.length).toBeGreaterThan(0);

		// Natural ventilation with negative dimensions
		const nvResult = calculateNaturalVentilation(nanInput, DEFAULT_ANALYSIS_CONFIGURATION);
		expect(nvResult.trace?.warnings.length).toBeGreaterThan(0);

		// Cooling capacity with NaN floorArea
		const ccResult = calculateCoolingCapacity(nanInput, DEFAULT_ANALYSIS_CONFIGURATION);
		expect(ccResult.trace?.warnings.length).toBeGreaterThan(0);

		// Artificial lighting with invalid CU/LLF out of range
		const badLightConfig = { ...DEFAULT_ANALYSIS_CONFIGURATION, coefficientOfUtilization: -0.5, lightLossFactor: 2.5 };
		const alResult = calculateArtificialLighting(input, badLightConfig, 500);
		expect(alResult.trace?.warnings.some((w) => w.includes('Invalid CU') || w.includes('Invalid LLF'))).toBe(true);
	});

	test('9. WWR bounds validation: window area exceeding wall area is clamped between 0 and 1 with warning', () => {
		// Create room with massive window area exceeding total wall area
		const side = 3.0;
		const smallRoom = createMockRoom('room_small_wall', 9, 3.0); // 3x3x3m -> wall area per side = 9m²
		const badTopology = createMockTopology([smallRoom], {
			exteriorConnections: [
				{
					id: 'ext_win_huge',
					openingId: 'win_huge',
					roomId: 'room_small_wall',
					storeyId: 'storey_1',
					type: 'window',
					width: 5.0,
					sillElevation: 0.9,
					headElevation: 3.9, // 5 * 3 = 15m² window on 9m² wall
					traversable: false,
					confidence: 0.9,
					sourceEvidenceIds: [],
					boundarySegment: {
						id: 'room_small_wall_wall_n',
						kind: 'wall',
						start: { x: 0, z: side },
						end: { x: side, z: side },
						sourceEvidenceIds: [],
						confidence: 0.9
					}
				}
			]
		});
		const badSemantics = createMockSemantics([smallRoom]);
		const [badInput] = buildRoomAnalysisInputs([smallRoom], badTopology, badSemantics, DEFAULT_ANALYSIS_CONFIGURATION);
		const ottvResult = calculateBuildingOttv([badInput], DEFAULT_ANALYSIS_CONFIGURATION);

		expect(ottvResult.facades.length).toBeGreaterThan(0);
		for (const fac of ottvResult.facades) {
			expect(fac.wwr).toBeGreaterThanOrEqual(0);
			expect(fac.wwr).toBeLessThanOrEqual(1.0);
			if (fac.trace?.warnings) {
				expect(fac.trace.warnings.some((w) => w.includes('WWR out of bounds'))).toBe(true);
			}
		}
		expect(ottvResult.overallWwr).toBeGreaterThanOrEqual(0);
		expect(ottvResult.overallWwr).toBeLessThanOrEqual(1.0);
	});
});
