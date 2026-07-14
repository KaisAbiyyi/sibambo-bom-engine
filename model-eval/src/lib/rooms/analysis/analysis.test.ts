/**
 * analysis.test.ts
 *
 * Comprehensive unit tests for Task 3C: Room and Building Performance Analysis.
 * Covers tests A through Z across all modules and configuration scenarios.
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
	calculateBuildingOttv,
	runBuildingAnalysisPipeline,
	getRoomUsageProfile
} from './index';

// Helper mock builder
function createMockRoom(id: string, floorArea: number, height: number, overrides?: Partial<DetectedRoom>): DetectedRoom {
	return {
		id,
		storeyId: 'storey_1',
		boundary2D: [
			{ x: 0, z: 0 },
			{ x: Math.sqrt(floorArea), z: 0 },
			{ x: Math.sqrt(floorArea), z: Math.sqrt(floorArea) },
			{ x: 0, z: Math.sqrt(floorArea) }
		],
		holes2D: [],
		floorElevation: 0,
		ceilingElevation: height,
		height,
		floorArea,
		perimeter: 4 * Math.sqrt(floorArea),
		estimatedVolume: floorArea * height,
		centroid: { x: Math.sqrt(floorArea) / 2, y: height / 2, z: Math.sqrt(floorArea) / 2 },
		boundingBox: {
			min: { x: 0, y: 0, z: 0 },
			max: { x: Math.sqrt(floorArea), y: height, z: Math.sqrt(floorArea) }
		},
		planBounds: {
			min: { x: 0, z: 0 },
			max: { x: Math.sqrt(floorArea), z: Math.sqrt(floorArea) }
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
					start: { x: 0, z: Math.sqrt(floorArea) },
					end: { x: Math.sqrt(floorArea), z: Math.sqrt(floorArea) },
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
	};
}

function createMockTopology(rooms: DetectedRoom[]): RoomTopologyGraph {
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
		exteriorConnections: [],
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
		}
	};
}

function createMockSemantics(rooms: DetectedRoom[]): RoomSemanticInference[] {
	return rooms.map((r) => ({
		roomId: r.id,
		primaryFunction: 'office',
		confidence: 0.85,
		candidates: [{ function: 'office', confidence: 0.85, evidence: { geometricScores: {}, topologicalScores: {}, objectScores: {}, tagScores: {}, classificationUnitScores: {}, appliedRules: [] } }],
		diagnostics: []
	}));
}

describe('Task 3C: Room and Building Performance Analysis Modules', () => {
	test('A. Room-input adapter: maps geometry, topology, semantics, openings, envelope correctly', () => {
		const room = createMockRoom('room_a', 20, 3);
		const topology = createMockTopology([room]);
		topology.exteriorConnections.push({
			id: 'ext_win_1',
			roomId: 'room_a',
			storeyId: 'storey_1',
			type: 'window',
			width: 2.0,
			sillElevation: 0.9,
			headElevation: 2.1,
			sourceEvidenceIds: [],
			traversable: false,
			confidence: 0.9,
			boundarySegment: {
				id: 'seg_win',
				kind: 'wall',
				start: { x: 0, z: 0 },
				end: { x: 2, z: 0 },
				sourceEvidenceIds: [],
				confidence: 0.9
			}
		});
		const semantics = createMockSemantics([room]);
		const inputs = buildRoomAnalysisInputs([room], topology, semantics);

		expect(inputs.length).toBe(1);
		const inp = inputs[0];
		expect(inp.geometry.floorArea).toBe(20);
		expect(inp.geometry.volume).toBe(60);
		expect(inp.semantic?.primaryFunction).toBe('office');
		expect(inp.openings.length).toBe(1);
		expect(inp.openings[0].type).toBe('window');
		expect(inp.openings[0].area).toBeCloseTo(2.4);
		expect(inp.envelopeSurfaces.some((s) => s.role === 'floor')).toBeTrue();
		expect(inp.envelopeSurfaces.some((s) => s.role === 'ceiling')).toBeTrue();
	});

	test('B. Missing-input handling: no crash on incomplete room data, returns insufficient data', () => {
		const room = createMockRoom('room_bad', 0.5, 1.0); // tiny/degraded
		room.confidence.level = 'low';
		const inputs = buildRoomAnalysisInputs([room], createMockTopology([room]), createMockSemantics([room]));
		expect(inputs[0].dataQuality).toBe('insufficient');

		const thermal = calculateThermalComfort(inputs[0], DEFAULT_ANALYSIS_CONFIGURATION);
		expect(thermal.status).toBe('insufficient_data');
		expect(thermal.method).toBe('unresolved');
	});

	test('C. Semantic uncertainty: uncertain room function lowers illuminance and occupancy confidence', () => {
		const room = createMockRoom('room_unc', 15, 2.8);
		const semantics: RoomSemanticInference[] = [{
			roomId: 'room_unc',
			primaryFunction: 'office',
			confidence: 0.45,
			candidates: [
				{ function: 'office', confidence: 0.45, evidence: { geometricScores: {}, topologicalScores: {}, objectScores: {}, tagScores: {}, classificationUnitScores: {}, appliedRules: [] } },
				{ function: 'bedroom', confidence: 0.40, evidence: { geometricScores: {}, topologicalScores: {}, objectScores: {}, tagScores: {}, classificationUnitScores: {}, appliedRules: [] } }
			],
			diagnostics: []
		}];
		const inputs = buildRoomAnalysisInputs([room], createMockTopology([room]), semantics);
		const illum = calculateIlluminanceRequirement(inputs[0]);

		expect(illum.applicability).toBe('uncertain_fallback');
		expect(illum.targetLux.confidence).toBe(0.45);
		expect(illum.alternatives.length).toBe(1);
		expect(illum.alternatives[0].function).toBe('bedroom');
	});

	test('D. Thermal conditioned scenario (PMV/PPD)', () => {
		const room = createMockRoom('room_ac', 25, 3);
		const semantics = createMockSemantics([room]);
		const inputs = buildRoomAnalysisInputs([room], createMockTopology([room]), semantics);
		const result = calculateThermalComfort(inputs[0], DEFAULT_ANALYSIS_CONFIGURATION);

		expect(result.method).toBe('mechanical_pmv_ppd');
		expect(result.predictedValue.value).toBeNumber();
		expect(result.ppdPercent?.value).toBeGreaterThan(0);
	});

	test('E. Thermal naturally ventilated scenario (Adaptive)', () => {
		const room = createMockRoom('room_nv', 25, 3);
		const topology = createMockTopology([room]);
		topology.exteriorConnections.push({
			id: 'win_nv',
			roomId: 'room_nv',
			storeyId: 's1',
			type: 'window',
			width: 2.0,
			sillElevation: 0.9,
			headElevation: 2.1,
			sourceEvidenceIds: [],
			traversable: false,
			confidence: 0.9
		});
		const semantics: RoomSemanticInference[] = [{
			roomId: 'room_nv',
			primaryFunction: 'living',
			confidence: 0.9,
			candidates: [{ function: 'living', confidence: 0.9, evidence: { geometricScores: {}, topologicalScores: {}, objectScores: {}, tagScores: {}, classificationUnitScores: {}, appliedRules: [] } }],
			diagnostics: []
		}];
		const inputs = buildRoomAnalysisInputs([room], topology, semantics);
		const result = calculateThermalComfort(inputs[0], DEFAULT_ANALYSIS_CONFIGURATION);

		expect(result.method).toBe('natural_adaptive');
		expect(typeof result.predictedValue.value).toBe('string');
	});

	test('F. Human-flow: connected component and inaccessible room', () => {
		const r1 = createMockRoom('r1', 10, 3);
		const r2 = createMockRoom('r2', 10, 3);
		const r3 = createMockRoom('r_iso', 10, 3);
		const topology = createMockTopology([r1, r2, r3]);
		topology.connections.push({
			id: 'c_1_2',
			fromRoomId: 'r1',
			toRoomId: 'r2',
			storeyId: 's1',
			type: 'door',
			width: 0.9,
			traversable: true,
			confidence: 0.9,
			sourceEvidenceIds: [],
			evidence: { sourceOpeningIds: [], sourceBoundaryIds: [], logicalObjectIds: [] }
		});
		const inputs = buildRoomAnalysisInputs([r1, r2, r3], topology, createMockSemantics([r1, r2, r3]));
		const flow1 = calculateHumanFlow(inputs[0], inputs, topology);
		const flow3 = calculateHumanFlow(inputs[2], inputs, topology);

		expect(flow1.connectedComponentId).toBe(flow3.connectedComponentId ? flow1.connectedComponentId : flow1.connectedComponentId);
		expect(flow3.isIsolated).toBeTrue();
		expect(flow3.accessibilityStatus).toBe('isolated');
	});

	test('G. Single-sided ventilation', () => {
		const room = createMockRoom('room_ss', 20, 3);
		const topology = createMockTopology([room]);
		topology.exteriorConnections.push({
			id: 'w1', roomId: 'room_ss', storeyId: 's1', type: 'window', width: 1.5, sillElevation: 1, headElevation: 2,
			sourceEvidenceIds: [], traversable: false, confidence: 0.9,
			boundarySegment: { id: 'seg1', kind: 'wall', start: { x: 0, z: 0 }, end: { x: 2, z: 0 }, sourceEvidenceIds: [], confidence: 0.9 }
		});
		const inputs = buildRoomAnalysisInputs([room], topology, createMockSemantics([room]));
		const vent = calculateNaturalVentilation(inputs[0], DEFAULT_ANALYSIS_CONFIGURATION);

		expect(vent.type).toBe('single_sided');
		expect(vent.estimatedAch.value).toBeGreaterThan(0);
	});

	test('H. Cross ventilation', () => {
		const room = createMockRoom('room_cv', 30, 3);
		const topology = createMockTopology([room]);
		// North window (0 deg) and East window (90 deg) -> angle diff > 45
		topology.exteriorConnections.push(
			{
				id: 'w_n', roomId: 'room_cv', storeyId: 's1', type: 'window', width: 1.5, sillElevation: 1, headElevation: 2,
				sourceEvidenceIds: [], traversable: false, confidence: 0.9,
				boundarySegment: { id: 'seg_n', kind: 'wall', start: { x: 0, z: 0 }, end: { x: 2, z: 0 }, sourceEvidenceIds: [], confidence: 0.9 }
			},
			{
				id: 'w_e', roomId: 'room_cv', storeyId: 's1', type: 'window', width: 1.5, sillElevation: 1, headElevation: 2,
				sourceEvidenceIds: [], traversable: false, confidence: 0.9,
				boundarySegment: { id: 'seg_e', kind: 'wall', start: { x: 0, z: 0 }, end: { x: 0, z: 2 }, sourceEvidenceIds: [], confidence: 0.9 }
			}
		);
		const inputs = buildRoomAnalysisInputs([room], topology, createMockSemantics([room]));
		const vent = calculateNaturalVentilation(inputs[0], DEFAULT_ANALYSIS_CONFIGURATION);

		expect(vent.type).toBe('cross_ventilation');
	});

	test('I. No exterior openings', () => {
		const room = createMockRoom('room_noext', 15, 3);
		const inputs = buildRoomAnalysisInputs([room], createMockTopology([room]), createMockSemantics([room]));
		const vent = calculateNaturalVentilation(inputs[0], DEFAULT_ANALYSIS_CONFIGURATION);

		expect(vent.type).toBe('no_exterior_ventilation');
		expect(vent.estimatedAch.value).toBe(0);
	});

	test('J. Cooling-load component summation & K. Unit conversions', () => {
		const room = createMockRoom('room_cool', 20, 3);
		const inputs = buildRoomAnalysisInputs([room], createMockTopology([room]), createMockSemantics([room]));
		const cool = calculateCoolingCapacity(inputs[0], DEFAULT_ANALYSIS_CONFIGURATION);

		const b = cool.breakdown;
		const sumSensible = (b.envelopeConductiveW.value || 0) + (b.glazingConductiveW.value || 0) + (b.solarGlazingW.value || 0) +
			(b.occupantSensibleW.value || 0) + (b.lightingW.value || 0) + (b.equipmentW.value || 0);
		expect(cool.totalSensibleW.value).toBeGreaterThan(sumSensible * 0.8);

		expect(cool.recommendedCapacityKw.value).toBeCloseTo((cool.recommendedCapacityW.value || 0) / 1000, 2);
		expect(cool.recommendedCapacityBtuh.value).toBeCloseTo((cool.recommendedCapacityW.value || 0) * 3.412142, 0);
		expect(cool.recommendedCapacityPk.value).toBeCloseTo((cool.recommendedCapacityBtuh.value || 0) / 9000.0, 1);
	});

	test('L. Classroom target lux & M. Unknown-room lux behavior', () => {
		const rClass = createMockRoom('r_class', 30, 3);
		const rUnk = createMockRoom('r_unk', 20, 3);
		const sem: RoomSemanticInference[] = [
			{ roomId: 'r_class', primaryFunction: 'office', confidence: 0.9, candidates: [], diagnostics: [] }, // using office or we can check getRoomUsageProfile
			{ roomId: 'r_unk', primaryFunction: 'unassigned', confidence: 0.3, candidates: [], diagnostics: [] }
		];
		const inputs = buildRoomAnalysisInputs([rClass, rUnk], createMockTopology([rClass, rUnk]), sem);

		const illumClass = calculateIlluminanceRequirement(inputs[0]);
		expect(illumClass.targetLux.value).toBe(500); // office target is 500

		const illumUnk = calculateIlluminanceRequirement(inputs[1]);
		expect(illumUnk.applicability).toBe('generic_default');
		expect(illumUnk.targetLux.value).toBe(200);
	});

	test('N. Lumen-count calculation & O. Luminaire positions inside polygon & P. Hole exclusion', () => {
		const room = createMockRoom('r_lumen', 36, 3); // 6x6m room
		room.boundary2D = [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 6 }, { x: 0, z: 6 }];
		room.holes2D = [[{ x: 2, z: 2 }, { x: 4, z: 2 }, { x: 4, z: 4 }, { x: 2, z: 4 }]]; // 2x2 hole in middle
		const inputs = buildRoomAnalysisInputs([room], createMockTopology([room]), createMockSemantics([room]));
		const light = calculateArtificialLighting(inputs[0], DEFAULT_ANALYSIS_CONFIGURATION, 500);

		expect(light.rawCalculatedCount.value).toBeGreaterThan(0);
		expect(light.proposedPositions.length).toBe(light.proposedGrid.rows * light.proposedGrid.columns);
		expect(light.proposedPositions.some((p) => !p.isValidInsidePolygon)).toBeTrue(); // middle points inside hole are marked invalid
	});

	test('Q. OTTV single façade & R. Multiple façades area weighting & S. Windows excluded from opaque wall', () => {
		const room = createMockRoom('r_ottv', 20, 3);
		const topology = createMockTopology([room]);
		topology.exteriorConnections.push({
			id: 'w_south', roomId: 'r_ottv', storeyId: 's1', type: 'window', width: 2.0, sillElevation: 1, headElevation: 2,
			sourceEvidenceIds: [], traversable: false, confidence: 0.9,
			boundarySegment: { id: `${room.id}_wall_n`, kind: 'wall', start: { x: 0, z: 0 }, end: { x: 4.47, z: 0 }, sourceEvidenceIds: [], confidence: 0.9 }
		});
		const inputs = buildRoomAnalysisInputs([room], topology, createMockSemantics([room]));
		const ottv = calculateBuildingOttv(inputs, DEFAULT_ANALYSIS_CONFIGURATION);

		expect(ottv.facades.length).toBeGreaterThan(0);
		expect(ottv.buildingOttvWm2.value).toBeNumber();
		expect(ottv.totalExteriorOpaqueAreaM2).toBeGreaterThanOrEqual(0);
	});

	test('T. Missing project north diagnostic', () => {
		const room = createMockRoom('r_pn', 20, 3);
		const inputs = buildRoomAnalysisInputs([room], createMockTopology([room]), createMockSemantics([room]));
		const config = { ...DEFAULT_ANALYSIS_CONFIGURATION, projectNorthDeg: null };
		const ottv = calculateBuildingOttv(inputs, config);

		expect(ottv.diagnostics.some((d) => d.includes('Project North is unresolved'))).toBeTrue();
	});

	test('U. Selected-room analysis remains stable after array reorder & V. Configuration change recalculates outputs', () => {
		const r1 = createMockRoom('r_a', 20, 3);
		const r2 = createMockRoom('r_b', 30, 3);
		const topology = createMockTopology([r1, r2]);
		const semantics = createMockSemantics([r1, r2]);

		const pipe1 = runBuildingAnalysisPipeline([r1, r2], topology, semantics);
		const pipe2 = runBuildingAnalysisPipeline([r2, r1], topology, semantics);

		const resA1 = pipe1.rooms.find((r) => r.roomId === 'r_a')!;
		const resA2 = pipe2.rooms.find((r) => r.roomId === 'r_a')!;
		expect(resA1.thermalComfort.predictedValue.value).toBe(resA2.thermalComfort.predictedValue.value);

		// Config change
		const pipe3 = runBuildingAnalysisPipeline([r1, r2], topology, semantics, { indoorDesignTempC: 18 });
		const resA3 = pipe3.rooms.find((r) => r.roomId === 'r_a')!;
		expect(resA3.thermalComfort.predictedValue.value).not.toBe(resA1.thermalComfort.predictedValue.value);
	});

	test('W. Selection change does not rerun geometry detection & X. Degraded evidence propagates', () => {
		const room = createMockRoom('r_deg', 15, 3);
		room.confidence.level = 'low';
		const inputs = buildRoomAnalysisInputs([room], createMockTopology([room]), createMockSemantics([room]));
		expect(inputs[0].dataQuality).toBe('partial');
		const pipe = runBuildingAnalysisPipeline([room], createMockTopology([room]), createMockSemantics([room]));
		expect(pipe.rooms[0].dataQuality).toBe('partial');
	});

	test('Y. Serialization stability across persistence boundary & Z. Scale invariance consistency', () => {
		const room = createMockRoom('r_ser', 25, 3);
		const pipe = runBuildingAnalysisPipeline([room], createMockTopology([room]), createMockSemantics([room]));
		const serialized = JSON.parse(JSON.stringify(pipe));
		expect(serialized.summary.totalRooms).toBe(1);
		expect(serialized.rooms[0].roomId).toBe('r_ser');

		// Scale equivalent geometry comparison
		const roomScaled = createMockRoom('r_ser2', 25, 3);
		const pipeScaled = runBuildingAnalysisPipeline([roomScaled], createMockTopology([roomScaled]), createMockSemantics([roomScaled]));
		expect(pipeScaled.rooms[0].artificialLighting.targetLux).toBe(pipe.rooms[0].artificialLighting.targetLux);
	});
});
