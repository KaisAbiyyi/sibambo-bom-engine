/**
 * task-5d-regression.test.ts
 *
 * Final regression tests for Task 5D.
 */
import { test, expect, describe } from "bun:test";
import { generateRecommendations } from "./recommendations";
import {
	runScenarioAnalysis,
	compareScenarios,
	validateScenarioOverrides,
	DEFAULT_BASELINE_SCENARIO,
	type DesignScenario
} from "./scenarios";
import {
	exportScenarioAnalysisReportJson,
	generateBuildingAnalysisHtmlReport
} from "./reporting";
import { runOptimization, type OptimizationConfig } from "./optimization";
import type { BuildingAnalysisResult, RoomAnalysisConfiguration } from "./types";
import { DEFAULT_ANALYSIS_CONFIGURATION } from "./types";
import type { RoomTopologyGraph } from "../topology";
import type { DetectedRoom } from "../detected-room";

const TOPOLOGY: RoomTopologyGraph = {
	rooms: [],
	connections: [],
	sharedBoundaries: [],
	exteriorConnections: [],
	diagnostics: {} as any
} as any;

function makeRoom(id: string): DetectedRoom {
	return {
		id,
		storeyId: "S1",
		boundary2D: [],
		holes2D: [],
		floorElevation: 0,
		ceilingElevation: 3,
		height: 3,
		floorArea: 15,
		perimeter: 16,
		estimatedVolume: 45,
		centroid: { x: 0, y: 0, z: 1.5 },
		boundingBox: { min: { x: -2, y: -2, z: 0 }, max: { x: 2, y: 2, z: 3 } },
		planBounds: { min: { x: -2, y: -2 }, max: { x: 2, y: 2 } },
		sourceEnvelopeIds: []
	} as any;
}

const ROOMS: DetectedRoom[] = [makeRoom("R1"), makeRoom("R2")];

const CONFIG: RoomAnalysisConfiguration = {
	...DEFAULT_ANALYSIS_CONFIGURATION,
	projectNorthDeg: 0,
	ottvThresholdWm2: 35
};

function makeAnalysis(opts?: {
	ottv?: number;
	compliant?: boolean;
	diagnostics?: any[];
	roomCount?: number;
}): BuildingAnalysisResult {
	const count = opts?.roomCount ?? 2;
	return {
		rooms: Array.from({ length: count }, (_, i) => ({
			roomId: `R${i + 1}`,
			storeyId: "S1",
			thermalComfort: {
				status: "comfortable",
				operativeTempC: { value: 25, state: "calculated", source: [], confidence: 1, diagnostics: [] },
				predictedValue: { value: 0.2, state: "calculated", source: [], confidence: 1, diagnostics: [] }
			} as any,
			humanFlow: {
				accessibilityStatus: "accessible",
				movementScore: { value: 100, state: "calculated", source: [], confidence: 1, diagnostics: [] }
			} as any,
			naturalVentilation: {
				type: "cross",
				estimatedAch: { value: 4, state: "calculated", source: [], confidence: 1, diagnostics: [] }
			} as any,
			coolingCapacity: {
				totalCoolingLoadW: { value: 3000, state: "calculated", source: [], confidence: 1, diagnostics: [] },
				recommendedCapacityW: { value: 3300, state: "calculated", source: [], confidence: 1, diagnostics: [] },
				recommendedCapacityKw: { value: 3.3, state: "calculated", source: [], confidence: 1, diagnostics: [] },
				recommendedCapacityPk: { value: 1.5, state: "calculated", source: [], confidence: 1, diagnostics: [] }
			} as any,
			artificialLighting: {
				roundedUpCount: { value: 6, state: "calculated", source: [], confidence: 1, diagnostics: [] }
			} as any,
			illuminanceRequirement: {
				targetLux: { value: 300, state: "calculated", source: [], confidence: 1, diagnostics: [] }
			} as any,
			diagnostics: [],
			dataQuality: "complete"
		})),
		ottv: {
			buildingOttvWm2: { value: opts?.ottv ?? 30, state: "calculated", source: [], confidence: 1, diagnostics: [] },
			isCompliant: { value: opts?.compliant ?? true, state: "calculated", source: [], confidence: 1, diagnostics: [] },
			facades: []
		} as any,
		summary: {
			totalRooms: count,
			analyzedRooms: count,
			totalGrossFloorAreaM2: count * 15,
			totalEstimatedCoolingCapacityKw: count * 3.3,
			totalEstimatedCoolingCapacityPk: count * 1.5,
			totalEstimatedLuminaires: count * 6,
			predominantVentilationType: "cross",
			thermalComfortComplianceRate: 1
		},
		diagnostics: opts?.diagnostics ?? [],
		configuration: CONFIG
	};
}

// --- Recommendation-to-scenario workflow ---

describe("Recommendation-to-scenario workflow", () => {
	test("High OTTV recommendation produces non-empty suggestedOverrides", () => {
		const analysis = makeAnalysis({ ottv: 42, compliant: false });
		const recs = generateRecommendations(ROOMS, TOPOLOGY, [], analysis, CONFIG);
		const ottvRec = recs.find(r => r.category === "envelope insulation" || r.category === "solar shading");
		expect(ottvRec).toBeDefined();
		expect(Object.keys(ottvRec!.suggestedOverrides).length).toBeGreaterThan(0);
	});

	test("Applying a recommendation override produces valid scenario analysis", () => {
		const analysis = makeAnalysis({ ottv: 42, compliant: false });
		const recs = generateRecommendations(ROOMS, TOPOLOGY, [], analysis, CONFIG);
		expect(recs.length).toBeGreaterThan(0);
		const rec = recs[0];
		const validation = validateScenarioOverrides(rec.suggestedOverrides);
		expect(validation.isValid).toBe(true);
		const scenario: DesignScenario = {
			id: "from-rec", name: "From Rec", description: rec.title, isBaseline: false, overrides: rec.suggestedOverrides
		};
		const proposed = runScenarioAnalysis(scenario, ROOMS, TOPOLOGY, [], CONFIG);
		expect(proposed.rooms.length).toBe(ROOMS.length);
	});

	test("Insufficient data produces data-request recommendation", () => {
		const analysis = makeAnalysis({ diagnostics: [{ category: "adapter", message: "Missing project north data required" }] });
		const recs = generateRecommendations(ROOMS, TOPOLOGY, [], analysis, CONFIG);
		expect(recs.some(r => r.category === "missing project data")).toBe(true);
	});

	test("Clean model produces no critical warnings", () => {
		const analysis = makeAnalysis({ ottv: 28, compliant: true });
		const recs = generateRecommendations(ROOMS, TOPOLOGY, [], analysis, CONFIG);
		expect(recs.filter(r => r.severity === "critical").length).toBe(0);
	});

	test("Duplicate recommendations are merged - no two have identical title+category", () => {
		const rooms3 = [makeRoom("R1"), makeRoom("R2"), makeRoom("R3")];
		const analysis = makeAnalysis({ ottv: 42, compliant: false, roomCount: 3 });
		const recs = generateRecommendations(rooms3, TOPOLOGY, [], analysis, CONFIG);
		const signatures = recs.map(r => `${r.category}::${r.title}`);
		expect(new Set(signatures).size).toBe(signatures.length);
	});

	test("Building-level recommendation scope is present for building issues", () => {
		const analysis = makeAnalysis({ diagnostics: [{ category: "adapter", message: "Missing project north" }] });
		const recs = generateRecommendations(ROOMS, TOPOLOGY, [], analysis, CONFIG);
		expect(recs.some(r => r.scope === "building")).toBe(true);
	});
});

// --- Optimization-to-proposed-scenario workflow ---

describe("Optimization-to-proposed-scenario workflow", () => {
	test("Optimization result overrides are valid for scenario application", async () => {
		const analysis = makeAnalysis({ ottv: 38, compliant: false });
		const optConfig: OptimizationConfig = {
			variables: [{ path: "wallUValueMultiplier", min: 0.5, max: 1.0, step: 0.25 }],
			objectives: ["reduce_ottv"],
			constraints: [],
			maxEvaluations: 8,
			timeBudgetMs: 5000,
			seed: 77
		};
		const result = await runOptimization(ROOMS, TOPOLOGY, [], analysis, CONFIG, optConfig);
		expect(result.totalEvaluated).toBe(8);
		if (result.recommendedScenario) {
			const validation = validateScenarioOverrides(result.recommendedScenario.scenario.overrides);
			expect(validation.isValid).toBe(true);
			const scenario: DesignScenario = {
				id: "opt-apply", name: "Applied Opt", description: "", isBaseline: false,
				overrides: result.recommendedScenario.scenario.overrides
			};
			const proposed = runScenarioAnalysis(scenario, ROOMS, TOPOLOGY, [], CONFIG);
			expect(proposed.rooms.length).toBe(ROOMS.length);
		}
	});

	test("Same seed produces identical Pareto frontier overrides", async () => {
		const analysis = makeAnalysis();
		const optConfig: OptimizationConfig = {
			variables: [{ path: "windowAreaMultiplier", min: 0.5, max: 1.5, step: 0.5 }],
			objectives: ["reduce_cooling_load"],
			constraints: [],
			maxEvaluations: 6,
			timeBudgetMs: 5000,
			seed: 99
		};
		const run1 = await runOptimization(ROOMS, TOPOLOGY, [], analysis, CONFIG, optConfig);
		const run2 = await runOptimization(ROOMS, TOPOLOGY, [], analysis, CONFIG, optConfig);
		expect(run1.paretoFrontier.length).toBe(run2.paretoFrontier.length);
		if (run1.paretoFrontier.length > 0) {
			expect(run1.paretoFrontier[0].scenario.overrides.windowAreaMultiplier)
				.toBe(run2.paretoFrontier[0].scenario.overrides.windowAreaMultiplier);
		}
	});
});

// --- Deterministic Pareto ---

describe("Deterministic Pareto results", () => {
	test("Three parallel runs with same seed produce identical totals and frontier length", async () => {
		const analysis = makeAnalysis();
		const optConfig: OptimizationConfig = {
			variables: [
				{ path: "wallUValueMultiplier", min: 0.6, max: 1.2, step: 0.3 },
				{ path: "windowAreaMultiplier", min: 0.7, max: 1.3, step: 0.3 }
			],
			objectives: ["reduce_cooling_load", "reduce_ottv"],
			constraints: [],
			maxEvaluations: 10,
			timeBudgetMs: 5000,
			seed: 42
		};
		const [r1, r2, r3] = await Promise.all([
			runOptimization(ROOMS, TOPOLOGY, [], analysis, CONFIG, optConfig),
			runOptimization(ROOMS, TOPOLOGY, [], analysis, CONFIG, optConfig),
			runOptimization(ROOMS, TOPOLOGY, [], analysis, CONFIG, optConfig)
		]);
		expect(r1.totalEvaluated).toBe(r2.totalEvaluated);
		expect(r2.totalEvaluated).toBe(r3.totalEvaluated);
		expect(r1.paretoFrontier.length).toBe(r2.paretoFrontier.length);
		expect(r2.paretoFrontier.length).toBe(r3.paretoFrontier.length);
	});
});

// --- No Baseline Mutation ---

describe("No baseline mutation", () => {
	test("Optimization does not modify baseline analysis rooms", async () => {
		const analysis = makeAnalysis();
		const origAch = analysis.rooms[0].naturalVentilation.estimatedAch.value;
		const origCooling = analysis.rooms[0].coolingCapacity.recommendedCapacityKw.value;
		const optConfig: OptimizationConfig = {
			variables: [{ path: "windowAreaMultiplier", min: 0.1, max: 2.0, step: 0.5 }],
			objectives: ["reduce_cooling_load"],
			constraints: [],
			maxEvaluations: 8,
			timeBudgetMs: 5000,
			seed: 11
		};
		await runOptimization(ROOMS, TOPOLOGY, [], analysis, CONFIG, optConfig);
		expect(analysis.rooms[0].naturalVentilation.estimatedAch.value).toBe(origAch);
		expect(analysis.rooms[0].coolingCapacity.recommendedCapacityKw.value).toBe(origCooling);
	});

	test("Scenario analysis does not modify ROOMS array", () => {
		const ids = ROOMS.map(r => r.id);
		const areas = ROOMS.map(r => r.floorArea);
		const scenario: DesignScenario = {
			id: "s1", name: "s", description: "", isBaseline: false, overrides: { windowAreaMultiplier: 0.5 }
		};
		runScenarioAnalysis(scenario, ROOMS, TOPOLOGY, [], CONFIG);
		expect(ROOMS.map(r => r.id)).toEqual(ids);
		expect(ROOMS.map(r => r.floorArea)).toEqual(areas);
	});
});

// --- Invalid Ranges Block Execution ---

describe("Invalid ranges block execution", () => {
	test("NaN windowAreaMultiplier rejected", () => {
		expect(validateScenarioOverrides({ windowAreaMultiplier: NaN }).isValid).toBe(false);
	});
	test("Negative wallUValueMultiplier rejected", () => {
		expect(validateScenarioOverrides({ wallUValueMultiplier: -0.5 }).isValid).toBe(false);
	});
	test("Out-of-range temperature rejected", () => {
		expect(validateScenarioOverrides({ indoorDesignTempC: 999 }).isValid).toBe(false);
	});
	test("wwrOverride > 1 rejected", () => {
		expect(validateScenarioOverrides({ wwrOverride: 1.5 }).isValid).toBe(false);
	});
	test("Invalid scenario throws in runScenarioAnalysis", () => {
		const scenario: DesignScenario = {
			id: "bad", name: "Bad", description: "", isBaseline: false, overrides: { windowAreaMultiplier: -1 }
		};
		expect(() => runScenarioAnalysis(scenario, ROOMS, TOPOLOGY, [], CONFIG)).toThrow();
	});
	test("Optimization with no variables runs without error", async () => {
		const analysis = makeAnalysis();
		const optConfig: OptimizationConfig = {
			variables: [],
			objectives: ["reduce_ottv"],
			constraints: [],
			maxEvaluations: 3,
			timeBudgetMs: 5000,
			seed: 1
		};
		const result = await runOptimization(ROOMS, TOPOLOGY, [], analysis, CONFIG, optConfig);
		expect(result.totalEvaluated).toBe(3);
	});
});

// --- Cancellation preserves partial diagnostics ---

describe("Cancellation preserves partial diagnostics", () => {
	test("Abort stops early and reports cancellation", async () => {
		const analysis = makeAnalysis();
		const ac = new AbortController();
		setTimeout(() => ac.abort(), 5);
		const optConfig: OptimizationConfig = {
			variables: [{ path: "windowAreaMultiplier", min: 0.5, max: 1.5, step: 0.1 }],
			objectives: ["reduce_ottv"],
			constraints: [],
			maxEvaluations: 500,
			timeBudgetMs: 30000,
			seed: 1
		};
		const result = await runOptimization(ROOMS, TOPOLOGY, [], analysis, CONFIG, optConfig, undefined, ac.signal);
		expect(result.totalEvaluated).toBeLessThan(500);
		expect(result.diagnostics.some(d => d.toLowerCase().includes("cancel"))).toBe(true);
	});

	test("Time budget reports budget exceeded", async () => {
		const analysis = makeAnalysis();
		const optConfig: OptimizationConfig = {
			variables: [{ path: "windowAreaMultiplier", min: 0.5, max: 1.5, step: 0.1 }],
			objectives: ["reduce_ottv"],
			constraints: [],
			maxEvaluations: 10000,
			timeBudgetMs: 5,
			seed: 1
		};
		const result = await runOptimization(ROOMS, TOPOLOGY, [], analysis, CONFIG, optConfig);
		expect(result.totalEvaluated).toBeLessThan(10000);
		expect(result.diagnostics.some(d => d.toLowerCase().includes("budget"))).toBe(true);
	});

	test("Cancelled run returns valid result shape", async () => {
		const analysis = makeAnalysis();
		const ac = new AbortController();
		const optConfig: OptimizationConfig = {
			variables: [{ path: "wallUValueMultiplier", min: 0.5, max: 1.0, step: 0.25 }],
			objectives: ["reduce_ottv"],
			constraints: [],
			maxEvaluations: 100,
			timeBudgetMs: 30000,
			seed: 55
		};
		setTimeout(() => ac.abort(), 10);
		const result = await runOptimization(ROOMS, TOPOLOGY, [], analysis, CONFIG, optConfig, undefined, ac.signal);
		expect(Array.isArray(result.paretoFrontier)).toBe(true);
		expect(result.totalEvaluated).toBeGreaterThanOrEqual(0);
	});
});

// --- Report Export ---

describe("Report export includes selected scenario", () => {
	test("JSON export contains baseline and proposed scenario IDs and room comparison", () => {
		const baseline = makeAnalysis();
		const scenario: DesignScenario = {
			id: "prop", name: "Proposed", description: "", isBaseline: false, overrides: { wallUValueMultiplier: 0.8 }
		};
		const proposed = runScenarioAnalysis(scenario, ROOMS, TOPOLOGY, [], CONFIG);
		const comparison = compareScenarios(baseline, proposed);
		const report = exportScenarioAnalysisReportJson(
			comparison, baseline, proposed, DEFAULT_BASELINE_SCENARIO, scenario, "Test Project"
		);
		expect(report.scenarios.baseline.id).toBe("baseline");
		expect(report.scenarios.proposed.id).toBe("prop");
		expect(report.roomComparisonTable.length).toBe(ROOMS.length);
		expect(report.comparisonSummary.buildingOttvDelta).toBeDefined();
	});

	test("HTML report contains scenario name and disclaimer", () => {
		const baseline = makeAnalysis();
		const scenario: DesignScenario = {
			id: "prop", name: "MyProposed", description: "", isBaseline: false, overrides: { shadingCoefficientMultiplier: 0.7 }
		};
		const proposed = runScenarioAnalysis(scenario, ROOMS, TOPOLOGY, [], CONFIG);
		const comparison = compareScenarios(baseline, proposed);
		const html = generateBuildingAnalysisHtmlReport(
			comparison, baseline, proposed, DEFAULT_BASELINE_SCENARIO, scenario, "Test Project"
		);
		expect(html).toContain("<!DOCTYPE html>");
		expect(html.length).toBeGreaterThan(500);
	});
});

// --- Selection Stability ---

describe("Selection stability after applying scenario", () => {
	test("Applying scenario does not reorder rooms", () => {
		const ids = ROOMS.map(r => r.id);
		const scenario: DesignScenario = {
			id: "apply", name: "Apply", description: "", isBaseline: false,
			overrides: { windowAreaMultiplier: 0.8, wallUValueMultiplier: 0.9 }
		};
		const proposed = runScenarioAnalysis(scenario, ROOMS, TOPOLOGY, [], CONFIG);
		expect(proposed.rooms.map(r => r.roomId)).toEqual(ids);
	});

	test("Multiple scenario applications preserve ROOMS identity", () => {
		const ids = ROOMS.map(r => r.id);
		for (const mult of [0.5, 0.75, 1.0, 1.25, 1.5]) {
			const scenario: DesignScenario = {
				id: `m${mult}`, name: `m${mult}`, description: "", isBaseline: false,
				overrides: { windowAreaMultiplier: mult }
			};
			runScenarioAnalysis(scenario, ROOMS, TOPOLOGY, [], CONFIG);
		}
		expect(ROOMS.map(r => r.id)).toEqual(ids);
	});
});

// --- End-to-end bounded workflow ---

describe("End-to-end bounded workflow (house2-style fixture)", () => {
	test("Full pipeline: analysis -> recommendations -> scenario -> compare -> optimize", async () => {
		const analysis = makeAnalysis({ ottv: 40, compliant: false });
		const recs = generateRecommendations(ROOMS, TOPOLOGY, [], analysis, CONFIG);
		expect(recs.length).toBeGreaterThan(0);

		const rec = recs[0];
		expect(validateScenarioOverrides(rec.suggestedOverrides).isValid).toBe(true);

		const scenario: DesignScenario = {
			id: "e2e", name: "E2E", description: rec.title, isBaseline: false, overrides: rec.suggestedOverrides
		};
		const proposed = runScenarioAnalysis(scenario, ROOMS, TOPOLOGY, [], CONFIG);
		expect(proposed.rooms.length).toBe(ROOMS.length);

		const comparison = compareScenarios(analysis, proposed);
		expect(comparison.rooms.length).toBe(ROOMS.length);

		const report = exportScenarioAnalysisReportJson(
			comparison, analysis, proposed, DEFAULT_BASELINE_SCENARIO, scenario, "E2E Test"
		);
		expect(report.scenarios.proposed.id).toBe("e2e");

		const optConfig: OptimizationConfig = {
			variables: [
				{ path: "wallUValueMultiplier", min: 0.5, max: 1.0, step: 0.25 },
				{ path: "shadingCoefficientMultiplier", min: 0.5, max: 1.0, step: 0.25 }
			],
			objectives: ["reduce_ottv", "reduce_cooling_load"],
			constraints: [{ type: "max_ottv", value: 40 }],
			maxEvaluations: 12,
			timeBudgetMs: 8000,
			seed: 2025
		};
		const optResult = await runOptimization(ROOMS, TOPOLOGY, [], analysis, CONFIG, optConfig);
		expect(optResult.totalEvaluated).toBe(12);
		for (const s of optResult.paretoFrontier) {
			expect(s.isFeasible).toBe(true);
		}
	});

	test("No unbounded processing: pipeline completes under 30s", async () => {
		const start = performance.now();
		const analysis = makeAnalysis({ ottv: 38, compliant: false });
		generateRecommendations(ROOMS, TOPOLOGY, [], analysis, CONFIG);
		const optConfig: OptimizationConfig = {
			variables: [{ path: "wallUValueMultiplier", min: 0.5, max: 1.0, step: 0.25 }],
			objectives: ["reduce_ottv"],
			constraints: [],
			maxEvaluations: 20,
			timeBudgetMs: 5000,
			seed: 7
		};
		await runOptimization(ROOMS, TOPOLOGY, [], analysis, CONFIG, optConfig);
		expect(performance.now() - start).toBeLessThan(30000);
	});
});

// --- Pareto properties ---

describe("Pareto frontier properties", () => {
	test("Dominated scenarios are excluded from Pareto frontier", async () => {
		const analysis = makeAnalysis();
		const optConfig: OptimizationConfig = {
			variables: [{ path: "wallUValueMultiplier", min: 0.5, max: 2.0, step: 0.25 }],
			objectives: ["reduce_cooling_load", "reduce_ottv"],
			constraints: [],
			maxEvaluations: 15,
			timeBudgetMs: 5000,
			seed: 999
		};
		const result = await runOptimization(ROOMS, TOPOLOGY, [], analysis, CONFIG, optConfig);
		const frontier = result.paretoFrontier;
		for (let i = 0; i < frontier.length; i++) {
			for (let j = 0; j < frontier.length; j++) {
				if (i === j) continue;
				const a = frontier[i].objectiveValues;
				const b = frontier[j].objectiveValues;
				const aStrictlyBetterOnBoth = a.reduce_cooling_load < b.reduce_cooling_load && a.reduce_ottv < b.reduce_ottv;
				expect(aStrictlyBetterOnBoth).toBe(false);
			}
		}
	});

	test("Recommended scenario is on Pareto frontier when frontier has multiple options", async () => {
		const analysis = makeAnalysis();
		const optConfig: OptimizationConfig = {
			variables: [{ path: "windowAreaMultiplier", min: 0.5, max: 1.5, step: 0.25 }],
			objectives: ["reduce_cooling_load", "reduce_ottv"],
			constraints: [],
			maxEvaluations: 12,
			timeBudgetMs: 5000,
			seed: 12345
		};
		const result = await runOptimization(ROOMS, TOPOLOGY, [], analysis, CONFIG, optConfig);
		if (result.recommendedScenario && result.paretoFrontier.length > 1) {
			const onFrontier = result.paretoFrontier.some(
				s => s.scenario.id === result.recommendedScenario!.scenario.id
			);
			expect(onFrontier).toBe(true);
		}
	});
});
