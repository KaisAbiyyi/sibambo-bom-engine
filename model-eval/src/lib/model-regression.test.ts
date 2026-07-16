import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTotalArea, getTotalVolume, parseBomModelJson, readBomModelData } from './model';

const fixtures = [
	['Model_SBMBOOST_bom_visual_nonPretty-print.json', resolve(import.meta.dir, '../../static/Model_SBMBOOST_bom_visual_nonPretty-print.json'), 'incomplete boundary', 0],
	['house2_model-eval.json', resolve(import.meta.dir, '../../static/dev-models/house2_model-eval.json'), 'incomplete boundary', 0],
	['presentation20_model-eval.json', resolve(import.meta.dir, '../../static/dev-models/presentation20_model-eval.json'), 'valid', 1],
	['SBOOST 1_model-eval.json', resolve(import.meta.dir, '../../../skps/model-eval-exports/PROJECT SBOOST 1_model-eval.json'), 'valid', 7],
	['SBOOST 2_model-eval.json', resolve(import.meta.dir, '../../../skps/model-eval-exports/PROJECT SBOOST 2_model-eval.json'), 'valid', 6]
] as const;

describe('iteration 1 regression corpus', () => {
	for (const [name, path, expectedState, minimumValidRooms] of fixtures) {
		test(`${name}: envelope categories, room state, validation, and category partition`, async () => {
			const bytes = readFileSync(path);
			const data = await readBomModelData(new File([bytes], name, { type: 'application/json' }), 1_000_000_000);
			const model = parseBomModelJson(data, name);
			const part = (key: string) => model.partStats.find((stat) => stat.key === key);

			expect(part('walls')?.count || 0).toBeGreaterThan(0);
			expect(part('floor')?.count || 0).toBeGreaterThan(0);
			expect(part('ceiling')?.count || 0).toBeGreaterThan(0);
			expect(model.partStats.every((stat) => stat.count > 0)).toBe(true);
			expect(model.validation.wallCount).toBeGreaterThan(0);
			expect(model.roomDetection.state).toBe(expectedState);
			expect(model.validation.detectedRoomCount).toBeGreaterThanOrEqual(minimumValidRooms);
			expect(model.roomDetection.reason.length).toBeGreaterThan(0);
			expect(new Set(model.faces.map((face) => face.id)).size).toBe(model.faces.length);
			expect(model.partStats.reduce((sum, stat) => sum + stat.count, 0)).toBe(model.faceCount);

			if (model.validation.downstreamAnalysisAllowed) {
				expect(model.roomDetection.state).toBe('valid');
				expect(getTotalArea(model.spaces)).toBeGreaterThan(0);
				expect(getTotalVolume(model.spaces)).toBeGreaterThan(0);
			} else {
				expect(model.roomDetection.state).not.toBe('valid');
				expect(model.validation.warnings.length).toBeGreaterThan(0);
			}
		});
	}

	test('SMBOOST fixture room/opening counts and component IDs stay exact', async () => {
		const expectedFixtures = [
			[fixtures[3], 4, 8],
			[fixtures[4], 4, 9]
		] as const;
		for (const [[name, path, , expected], expectedDoors, expectedWindows] of expectedFixtures) {
			const data = await readBomModelData(new File([readFileSync(path)], name, { type: 'application/json' }), 1_000_000_000);
			const model = parseBomModelJson(data, name);
			expect(model.validation.detectedRoomCount).toBe(expected);
			expect(model.validation.detectedDoorCount).toBe(expectedDoors);
			expect(model.validation.detectedWindowCount).toBe(expectedWindows);
			expect(model.validation.roomCountMatchesExpected).toBe(true);
			expect(model.validation.downstreamAnalysisAllowed).toBe(true);
			expect(model.componentIndex).toBeDefined();
			expect(new Set(model.componentIndex!.all.map((component) => component.id)).size).toBe(model.componentIndex!.all.length);
			expect(model.componentIndex!.bindings.every((binding) => binding.instancePath.length > 0 && binding.sourceFaceIds.length > 0)).toBe(true);
			expect(model.geometryRegistry).toBeDefined();
			expect(model.inspectionDiagnostics?.geometryIngestion.missingValidMeshes).toBe(0);
			expect(model.inspectionDiagnostics?.walls.finalLogicalWallCount).toBe(model.componentIndex!.walls.length);
			expect(model.inspectionDiagnostics!.walls.finalLogicalWallCount).toBeLessThan(model.inspectionDiagnostics!.walls.wallSurfaceGroupCount);
			const openingMeshIds = [...model.componentIndex!.doors, ...model.componentIndex!.windows].flatMap((opening) => opening.childMeshIds);
			expect(new Set(openingMeshIds).size).toBe(openingMeshIds.length);
			expect(model.componentIndex!.doors.every((opening) => opening.frameMeshIds.length > 0)).toBe(true);
			expect(model.componentIndex!.windows.every((opening) => opening.frameMeshIds.length > 0)).toBe(true);
			expect(model.componentIndex!.windows.some((opening) => opening.glassMeshIds.length > 0)).toBe(true);
		}
	});
});
