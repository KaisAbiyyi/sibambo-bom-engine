import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseModelEvalJsonV1 } from './formats/model-eval-json';
import { buildGeometryRegistry, diagnoseRenderCoverage } from './geometry-registry';
import { buildRuntimeGeometryGroups } from './render/build-runtime-scene';

describe('geometry registry', () => {
	for (const [name, path, sourceNodes, sourceMeshes] of [
		['SMBOOST 1', '../../../skps/model-eval-exports/PROJECT SBOOST 1_model-eval.json', 134, 70],
		['SMBOOST 2', '../../../skps/model-eval-exports/PROJECT SBOOST 2_model-eval.json', 117, 66]
	] as const) {
		test(`${name} registers every visible source mesh before classification`, () => {
			const scene = parseModelEvalJsonV1(JSON.parse(readFileSync(resolve(import.meta.dir, path), 'utf8')));
			const registry = buildGeometryRegistry(scene);
			expect(registry.sourceNodes.size).toBe(sourceNodes);
			expect(registry.renderableMeshes.size).toBe(sourceMeshes);
			expect(registry.unresolvedMeshes.size).toBe(sourceMeshes);
			expect([...registry.renderableMeshes.values()].every((record) => record.occurrences.every((occurrence) => occurrence.worldTransform.length === 16))).toBe(true);
			const coverage = diagnoseRenderCoverage(registry, buildRuntimeGeometryGroups(scene));
			expect(coverage.missingValidMeshes).toBe(0);
			expect(coverage.successfullyRenderedMeshes).toBe(sourceMeshes);
		});
	}

	test('keeps nested child meshes when a parent also has a mesh', () => {
		const scene = parseModelEvalJsonV1(JSON.parse(readFileSync(resolve(import.meta.dir, '../../../skps/model-eval-exports/PROJECT SBOOST 1_model-eval.json'), 'utf8')));
		const registry = buildGeometryRegistry(scene);
		const occurrencePaths = [...registry.renderableMeshes.values()].flatMap((record) => record.occurrences.map((occurrence) => occurrence.instancePath));
		const child = occurrencePaths.find((path) => occurrencePaths.some((parent) => parent !== path && path.startsWith(`${parent}/`)));
		expect(child).toBeDefined();
	});
});
