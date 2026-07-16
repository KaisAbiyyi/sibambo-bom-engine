import { test, expect } from 'bun:test';
import { generateRecommendations, mergeAndRankRecommendations, type BuildingDesignRecommendation } from './recommendations';
import type { BuildingAnalysisResult, RoomAnalysisResult, RoomAnalysisConfiguration } from './types';
import type { RoomTopologyGraph } from '../topology';
import type { DetectedRoom } from '../detected-room';
import { DEFAULT_ANALYSIS_CONFIGURATION } from './types';

// Mock helpers
function createMockAnalysis(
	overrides?: Partial<BuildingAnalysisResult>,
	roomOverrides?: Partial<RoomAnalysisResult>[]
): BuildingAnalysisResult {
	return {
		rooms: roomOverrides ? roomOverrides.map((r, i) => ({
			roomId: r.roomId || `R${i + 1}`,
			thermalComfort: { 
				status: 'pass',
				operativeTempC: { value: 25, state: 'calculated', source: [], confidence: 1, diagnostics: [] },
				predictedValue: { value: 0, state: 'calculated', source: [], confidence: 1, diagnostics: [] }
			} as any,
			humanFlow: { 
				accessibilityStatus: 'accessible',
				movementScore: { value: 100, state: 'calculated', source: [], confidence: 1, diagnostics: [] }
			} as any,
			naturalVentilation: {
				ventilationType: 'cross',
				estimatedAch: { value: 5, state: 'calculated', source: [], confidence: 1, diagnostics: [] }
			} as any,
			coolingCapacity: {
				totalCoolingLoadW: { value: 2000, state: 'calculated', source: [], confidence: 1, diagnostics: [] },
				requiredCoolingKw: { value: 2, state: 'calculated', source: [], confidence: 1, diagnostics: [] },
				recommendedCapacityKw: { value: 2.5, state: 'calculated', source: [], confidence: 1, diagnostics: [] },
				recommendedCapacityW: { value: 2500, state: 'calculated', source: [], confidence: 1, diagnostics: [] },
				recommendedCapacityPk: { value: 1, state: 'calculated', source: [], confidence: 1, diagnostics: [] }
			} as any,
			artificialLighting: {
				roundedUpCount: { value: 4, state: 'calculated', source: [], confidence: 1, diagnostics: [] }
			} as any,
			illuminanceRequirement: {
				targetLux: { value: 200, state: 'calculated', source: [], confidence: 1, diagnostics: [] }
			} as any,
			diagnostics: [],
			dataQuality: 'complete',
			...r
		})) : [],
		ottv: {
			buildingOttvWm2: { value: 30, state: 'calculated', source: [], confidence: 1, diagnostics: [] },
			isCompliant: { value: true, state: 'calculated', source: [], confidence: 1, diagnostics: [] },
			facades: []
		} as any,
		diagnostics: overrides?.diagnostics || [],
		summary: { totalRooms: 1, analyzedRooms: 1, totalGrossFloorAreaM2: 10, totalEstimatedCoolingCapacityKw: 2, totalEstimatedCoolingCapacityPk: 1, totalEstimatedLuminaires: 4, predominantVentilationType: 'single_sided', thermalComfortComplianceRate: 1 },
		configuration: DEFAULT_ANALYSIS_CONFIGURATION,
		...overrides
	} as BuildingAnalysisResult;
}

const DUMMY_ROOMS: DetectedRoom[] = [];
const DUMMY_TOPOLOGY: RoomTopologyGraph = { rooms: [], connections: [], sharedBoundaries: [], exteriorConnections: [], diagnostics: { } as any };
const DUMMY_CONFIG: RoomAnalysisConfiguration = DEFAULT_ANALYSIS_CONFIGURATION;

import { mock } from 'bun:test';

test('Missing project north produces building-level data request recommendation', () => {
	const analysis = createMockAnalysis({
		diagnostics: [{ category: 'adapter', message: 'Missing project north' }]
	});
	const recs = generateRecommendations(DUMMY_ROOMS, DUMMY_TOPOLOGY, [], analysis, DUMMY_CONFIG);
	
	expect(recs.length).toBe(1);
	expect(recs[0].category).toBe('missing project data');
	expect(recs[0].scope).toBe('building');
	expect(recs[0].severity).toBe('critical');
});

test('High OTTV produces envelope and shading recommendations', () => {
	const analysis = createMockAnalysis({
		ottv: { 
			buildingOttvWm2: { value: 40, state: 'calculated', source: [], confidence: 1, diagnostics: [] },
			isCompliant: { value: false, state: 'calculated', source: [], confidence: 1, diagnostics: [] },
			facades: []
		} as any
	});
	const recs = generateRecommendations(DUMMY_ROOMS, DUMMY_TOPOLOGY, [], analysis, DUMMY_CONFIG);
	
	expect(recs.some(r => r.category === 'envelope insulation')).toBe(true);
	expect(recs.some(r => r.category === 'solar shading')).toBe(true);
});

test('Poor ventilation produces opening/path recommendations', () => {
	const analysis = createMockAnalysis({}, [{
		roomId: 'R1',
		naturalVentilation: {
			ventilationType: 'single-sided',
			estimatedAch: { value: 1.5, state: 'calculated', source: [], confidence: 1, diagnostics: [] }
		} as any
	}]);
	const recs = generateRecommendations(DUMMY_ROOMS, DUMMY_TOPOLOGY, [], analysis, DUMMY_CONFIG);
	
	const rec = recs.find(r => r.category === 'natural ventilation');
	expect(rec).toBeDefined();
	expect(rec?.severity).toBe('warning');
	expect(rec?.suggestedOverrides.windowAreaMultiplier).toBe(1.5);
});

test('AC capacity constraint: high cooling load triggers recommendation', () => {
	const analysis = createMockAnalysis({}, [{
		roomId: 'R1',
		coolingCapacity: {
			totalCoolingLoadW: { value: 12000, state: 'calculated', source: [], confidence: 1, diagnostics: [] },
			requiredCoolingKw: { value: 12, state: 'calculated', source: [], confidence: 1, diagnostics: [] },
			recommendedCapacityKw: { value: 14, state: 'calculated', source: [], confidence: 1, diagnostics: [] },
			recommendedCapacityW: { value: 14000, state: 'calculated', source: [], confidence: 1, diagnostics: [] },
			recommendedCapacityPk: { value: 6, state: 'calculated', source: [], confidence: 1, diagnostics: [] }
		} as any
	}]);
	const recs = generateRecommendations(DUMMY_ROOMS, DUMMY_TOPOLOGY, [], analysis, DUMMY_CONFIG);
	
	const rec = recs.find(r => r.category === 'AC capacity');
	expect(rec).toBeDefined();
});

test('Inaccessible room produces circulation recommendations', () => {
	const analysis = createMockAnalysis({}, [{
		roomId: 'R1',
		humanFlow: { accessibilityStatus: 'isolated', areaM2: 10, totalPeople: 1, flowRateM2s: 0, clearanceM: 0 } as any
	}]);
	const recs = generateRecommendations(DUMMY_ROOMS, DUMMY_TOPOLOGY, [], analysis, DUMMY_CONFIG);
	
	const rec = recs.find(r => r.category === 'circulation/access');
	expect(rec).toBeDefined();
});

test('Duplicate merging merges multiple rooms with same issue', () => {
	const analysis = createMockAnalysis({}, [
		{
			roomId: 'R1',
			naturalVentilation: {
				ventilationType: 'single-sided',
				estimatedAch: { value: 1.5, state: 'calculated', source: [], confidence: 1, diagnostics: [] }
			} as any
		},
		{
			roomId: 'R2',
			naturalVentilation: {
				ventilationType: 'single-sided',
				estimatedAch: { value: 1.5, state: 'calculated', source: [], confidence: 1, diagnostics: [] }
			} as any
		}
	]);
	const recs = generateRecommendations(DUMMY_ROOMS, DUMMY_TOPOLOGY, [], analysis, DUMMY_CONFIG);
	
	expect(recs.length).toBe(1);
	expect(recs[0].roomIds).toContain('R1');
	expect(recs[0].roomIds).toContain('R2');
});

test('Deterministic ranking sorts by severity and confidence', () => {
	const recs: BuildingDesignRecommendation[] = [
		{ id: '', scope: 'room', roomIds: ['R1'], category: 'lighting quantity', severity: 'info', title: 'C', explanation: '', evidence: [], suggestedOverrides: {}, estimatedImpact: {}, confidence: 1, assumptions: [], limitations: [] },
		{ id: '', scope: 'building', roomIds: [], category: 'missing project data', severity: 'critical', title: 'A', explanation: '', evidence: [], suggestedOverrides: {}, estimatedImpact: {}, confidence: 1, assumptions: [], limitations: [] },
		{ id: '', scope: 'room', roomIds: ['R2'], category: 'natural ventilation', severity: 'warning', title: 'B', explanation: '', evidence: [], suggestedOverrides: {}, estimatedImpact: {}, confidence: 1, assumptions: [], limitations: [] }
	];

	const ranked = mergeAndRankRecommendations(recs);
	expect(ranked[0].severity).toBe('critical');
	expect(ranked[1].severity).toBe('warning');
	expect(ranked[2].severity).toBe('info');
});

test('Conflict reporting finds conflicts between ventilation and OTTV', () => {
	const analysis = createMockAnalysis({
		ottv: { 
			buildingOttvWm2: { value: 40, state: 'calculated', source: [], confidence: 1, diagnostics: [] },
			isCompliant: { value: false, state: 'calculated', source: [], confidence: 1, diagnostics: [] },
			facades: []
		} as any
	}, [
		{
			roomId: 'R1',
			naturalVentilation: {
				ventilationType: 'single-sided',
				estimatedAch: { value: 1.5, state: 'calculated', source: [], confidence: 1, diagnostics: [] }
			} as any
		}
	]);
	const recs = generateRecommendations(DUMMY_ROOMS, DUMMY_TOPOLOGY, [], analysis, DUMMY_CONFIG);
	
	const ventRec = recs.find(r => r.category === 'natural ventilation');
	expect(ventRec?.limitations.some(l => l.includes('Conflicts with: High Overall Thermal Transfer Value (OTTV)'))).toBe(true);
});
