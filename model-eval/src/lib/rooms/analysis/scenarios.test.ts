import { describe, it, expect } from 'bun:test';
import type { DetectedRoom } from '../detected-room';
import type { RoomTopologyGraph } from '../topology';
import type { RoomSemanticInference } from '../semantics';
import {
	validateScenarioOverrides,
	runScenarioAnalysis,
	compareScenarios,
	DEFAULT_BASELINE_SCENARIO,
	DEFAULT_PROPOSED_SCENARIO,
	type DesignScenario
} from './scenarios';
import { exportScenarioAnalysisReportJson, generateBuildingAnalysisHtmlReport } from './reporting';

function makeMockRoom(id: string, name: string, floorArea: number, storeyId = 'storey-1'): DetectedRoom {
	return {
		id,
		storeyId,
		floorElevation: 0,
		ceilingElevation: 3.0,
		height: 3.0,
		floorArea,
		perimeter: 4 * Math.sqrt(floorArea),
		estimatedVolume: floorArea * 3.0,
		centroid: { x: 5, y: 1.5, z: 5 },
		confidence: { level: 'high', score: 0.9, factors: [] },
		planBounds: {
			min: { x: 0, y: 0, z: 0 },
			max: { x: Math.sqrt(floorArea), y: 3.0, z: Math.sqrt(floorArea) }
		},
		surfaces: [
			{
				id: `${id}-wall-1`,
				type: 'wall',
				plane: { normal: { x: 0, y: 0, z: 1 }, distance: 0 },
				boundaryPolygon: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }],
				holes: [],
				area: 12.0
			}
		],
		boundaries: [
			{
				id: `${id}-b-1`,
				surfaceId: `${id}-wall-1`,
				plane: { normal: { x: 0, y: 0, z: 1 }, distance: 0 },
				polygon2D: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }],
				area: 12.0,
				height: 3.0,
				role: 'exterior_wall'
			}
		],
		openings: []
	} as any;
}

function makeMockTopology(rooms: DetectedRoom[]): RoomTopologyGraph {
	return {
		rooms: rooms.map((r) => ({
			roomId: r.id,
			storeyId: r.storeyId,
			centroid: r.centroid,
			boundaryIds: r.boundaries.map((b) => b.id),
			connectionIds: [],
			exteriorConnectionIds: []
		})),
		connections: [],
		sharedBoundaries: [],
		exteriorBoundaries: rooms.map((r) => ({
			id: `${r.id}-ext-bound`,
			roomId: r.id,
			segment: { id: `${r.id}-seg-1`, start: { x: 0, z: 0 }, end: { x: 4, z: 0 } },
			role: 'exterior_wall' as const,
			length: 4.0
		})),
		exteriorConnections: rooms.map((r) => ({
			id: `${r.id}-ext-win`,
			roomId: r.id,
			boundaryId: r.boundaries[0].id,
			openingId: `${r.id}-win-1`,
			openingType: 'window' as const,
			area: 2.0,
			width: 1.5,
			height: 1.33,
			sillElevation: 0.9,
			headElevation: 2.23
		}))
	};
}

function makeMockSemantics(rooms: DetectedRoom[]): RoomSemanticInference[] {
	return rooms.map((r) => ({
		roomId: r.id,
		storeyId: r.storeyId,
		primaryFunction: 'office',
		confidence: 0.9,
		evidence: ['desk', 'chair']
	}));
}

describe('Task 3E: Design-Scenario Comparison & Reporting', () => {
	describe('validateScenarioOverrides', () => {
		it('returns valid for clean overrides', () => {
			const res = validateScenarioOverrides({
				indoorDesignTempC: 23,
				outdoorDesignTempC: 34,
				wwrOverride: 0.4,
				wallUValueMultiplier: 0.8
			});
			expect(res.isValid).toBe(true);
			expect(res.errors).toHaveLength(0);
		});

		it('rejects out-of-range temperatures or non-finite values', () => {
			const res = validateScenarioOverrides({
				indoorDesignTempC: -100,
				outdoorDesignTempC: NaN,
				wwrOverride: 1.5,
				coefficientOfUtilization: -0.1
			});
			expect(res.isValid).toBe(false);
			expect(res.errors.length).toBeGreaterThanOrEqual(4);
			expect(res.errors.some((e) => e.includes('indoorDesignTempC'))).toBe(true);
			expect(res.errors.some((e) => e.includes('wwrOverride'))).toBe(true);
		});
	});

	describe('runScenarioAnalysis immutability and calculations', () => {
		it('evaluates baseline and proposed scenarios without mutating base rooms or topology', () => {
			const rooms = [makeMockRoom('r1', 'Office 101', 25.0)];
			const topology = makeMockTopology(rooms);
			const semantics = makeMockSemantics(rooms);

			// Save initial values
			const origArea = rooms[0].floorArea;
			const origBoundArea = rooms[0].boundaries[0].area;
			const origExtArea = topology.exteriorConnections[0].area;

			const baseRes = runScenarioAnalysis(DEFAULT_BASELINE_SCENARIO, rooms, topology, semantics);
			const propRes = runScenarioAnalysis(DEFAULT_PROPOSED_SCENARIO, rooms, topology, semantics);

			// Check immutability
			expect(rooms[0].floorArea).toBe(origArea);
			expect(rooms[0].boundaries[0].area).toBe(origBoundArea);
			expect(topology.exteriorConnections[0].area).toBe(origExtArea);

			// Proposed efficiency should have lower cooling load and lower or equal luminaire count
			const baseCoolingPk = baseRes.summary.totalEstimatedCoolingCapacityPk;
			const propCoolingPk = propRes.summary.totalEstimatedCoolingCapacityPk;
			expect(propCoolingPk).toBeLessThan(baseCoolingPk);
		});

		it('throws an explicit error when scenario overrides contain invalid numbers', () => {
			const rooms = [makeMockRoom('r1', 'Office 101', 25.0)];
			const invalidScenario: DesignScenario = {
				id: 'bad',
				name: 'Bad Scenario',
				description: 'Invalid WWR and temp',
				isBaseline: false,
				overrides: { wwrOverride: 2.5, indoorDesignTempC: Infinity }
			};

			expect(() => runScenarioAnalysis(invalidScenario, rooms, makeMockTopology(rooms), makeMockSemantics(rooms))).toThrow(/Scenario validation failed/);
		});
	});

	describe('compareScenarios engine', () => {
		it('produces exact zero differences when comparing identical baseline to itself', () => {
			const rooms = [makeMockRoom('r1', 'Office 101', 25.0)];
			const baseRes = runScenarioAnalysis(DEFAULT_BASELINE_SCENARIO, rooms, makeMockTopology(rooms), makeMockSemantics(rooms));
			const comparison = compareScenarios(baseRes, baseRes, 'base', 'base-copy');

			expect(comparison.buildingSummaryDelta.totalGrossFloorAreaM2Delta.absoluteDifference).toBe(0);
			expect(comparison.buildingSummaryDelta.totalGrossFloorAreaM2Delta.percentageDifference).toBe(0);
			expect(comparison.buildingSummaryDelta.totalGrossFloorAreaM2Delta.status).toBe('unchanged');

			expect(comparison.buildingSummaryDelta.totalEstimatedCoolingCapacityPkDelta.absoluteDifference).toBe(0);
			expect(comparison.buildingSummaryDelta.totalEstimatedCoolingCapacityPkDelta.status).toBe('unchanged');

			expect(comparison.ottvDelta.buildingOttvWm2Delta.absoluteDifference).toBe(0);
			expect(comparison.ottvDelta.buildingOttvWm2Delta.status).toBe('unchanged');

			expect(comparison.rooms[0].coolingCapacityPkDelta.absoluteDifference).toBe(0);
			expect(comparison.rooms[0].coolingCapacityPkDelta.status).toBe('unchanged');
		});

		it('identifies improved and degraded metrics accurately between baseline and proposed', () => {
			const rooms = [makeMockRoom('r1', 'Office 101', 36.0)];
			const baseRes = runScenarioAnalysis(DEFAULT_BASELINE_SCENARIO, rooms, makeMockTopology(rooms), makeMockSemantics(rooms));
			const propRes = runScenarioAnalysis(DEFAULT_PROPOSED_SCENARIO, rooms, makeMockTopology(rooms), makeMockSemantics(rooms));

			const comp = compareScenarios(baseRes, propRes);
			expect(comp.buildingSummaryDelta.totalEstimatedCoolingCapacityPkDelta.status).toBe('improved');
			expect(comp.buildingSummaryDelta.totalEstimatedCoolingCapacityPkDelta.absoluteDifference).toBeLessThan(0);
			expect(comp.ottvDelta.buildingOttvWm2Delta.status).toBe('improved');
			expect(comp.ottvDelta.buildingOttvWm2Delta.absoluteDifference).toBeLessThan(0);
		});

		it('reports missing rooms explicitly when topology changes between scenarios', () => {
			const roomsBase = [makeMockRoom('r1', 'Office A', 20.0), makeMockRoom('r2', 'Office B', 20.0)];
			const roomsProp = [makeMockRoom('r1', 'Office A', 20.0), makeMockRoom('r3', 'New Meeting Room', 30.0)];

			const baseRes = runScenarioAnalysis(DEFAULT_BASELINE_SCENARIO, roomsBase, makeMockTopology(roomsBase), makeMockSemantics(roomsBase));
			const propRes = runScenarioAnalysis(DEFAULT_PROPOSED_SCENARIO, roomsProp, makeMockTopology(roomsProp), makeMockSemantics(roomsProp));

			const comp = compareScenarios(baseRes, propRes);
			expect(comp.missingRooms.missingInProposed).toContain('r2');
			expect(comp.missingRooms.missingInBaseline).toContain('r3');

			const r2Comp = comp.rooms.find((r) => r.roomId === 'r2');
			expect(r2Comp?.status).toBe('missing_in_proposed');

			const r3Comp = comp.rooms.find((r) => r.roomId === 'r3');
			expect(r3Comp?.status).toBe('missing_in_baseline');
		});
	});

	describe('export and report generation', () => {
		it('generates structured JSON bundle preserving traces, units, and summary deltas', () => {
			const rooms = [makeMockRoom('r1', 'Office 101', 30.0)];
			const baseRes = runScenarioAnalysis(DEFAULT_BASELINE_SCENARIO, rooms, makeMockTopology(rooms), makeMockSemantics(rooms));
			const propRes = runScenarioAnalysis(DEFAULT_PROPOSED_SCENARIO, rooms, makeMockTopology(rooms), makeMockSemantics(rooms));
			const comp = compareScenarios(baseRes, propRes);

			const jsonExport = exportScenarioAnalysisReportJson(comp, baseRes, propRes, DEFAULT_BASELINE_SCENARIO, DEFAULT_PROPOSED_SCENARIO, 'Test Project');
			expect(jsonExport.schemaVersion).toBe('3.0.0-scenario-eval');
			expect(jsonExport.projectSummary.projectName).toBe('Test Project');
			expect(jsonExport.detailedResults.baseline.rooms[0].coolingCapacity.trace?.method).toBeDefined();
			expect(jsonExport.knownLimitations.length).toBeGreaterThan(0);
		});

		it('generates responsive printable HTML report containing summary cards and comparison tables', () => {
			const rooms = [makeMockRoom('r1', 'Office 101', 30.0)];
			const baseRes = runScenarioAnalysis(DEFAULT_BASELINE_SCENARIO, rooms, makeMockTopology(rooms), makeMockSemantics(rooms));
			const propRes = runScenarioAnalysis(DEFAULT_PROPOSED_SCENARIO, rooms, makeMockTopology(rooms), makeMockSemantics(rooms));
			const comp = compareScenarios(baseRes, propRes);

			const htmlReport = generateBuildingAnalysisHtmlReport(comp, baseRes, propRes, DEFAULT_BASELINE_SCENARIO, DEFAULT_PROPOSED_SCENARIO, 'Test Project');
			expect(htmlReport).toContain('<!DOCTYPE html>');
			expect(htmlReport).toContain('Building Analysis Report: Test Project');
			expect(htmlReport).toContain('Peak Cooling Capacity');
			expect(htmlReport).toContain('Façade OTTV Breakdown');
			expect(htmlReport).toContain('Known Method Limitations & Engineering Disclaimers');
		});
	});
});
