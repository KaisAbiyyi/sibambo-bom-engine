import { describe, expect, test } from 'bun:test';
import schema from '../../../../bom_engine_plugin/schema/model-eval-json-1.0.schema.json';
import example from '../../../../bom_engine_plugin/examples/model-eval-json-v1-small.json';
import Ajv2020 from 'ajv/dist/2020.js';
import { parseBomModelJson, readBomModelData } from '../model';
import { isModelEvalJsonV1, parseModelEvalJsonV1 } from './model-eval-json';

describe('model_eval_json_v1', () => {
	test('validates schema and builds direct indexed runtime', () => {
		const validate = new Ajv2020({ strict: false }).compile(schema);
		expect(validate(example)).toBe(true);
		expect(isModelEvalJsonV1(example)).toBe(true);
		const runtime = parseModelEvalJsonV1(example);
		expect(runtime.format).toBe('model_eval_json_v1');
		expect(runtime.meshes[0].positions).toBeInstanceOf(Float32Array);
		expect(runtime.meshes[0].triangles).toBeInstanceOf(Uint32Array);
		expect(runtime.meshes[0].positions).toHaveLength(12);
		expect(runtime.meshes[0].manifest.quantization.measured_max_error_m).toBeLessThanOrEqual(0.001);
	});

	test('public dispatch retains compact runtime and avoids legacy face expansion', async () => {
		const file = new File([JSON.stringify(example)], 'fixture_model-eval.json', { type: 'application/json' });
		const data = await readBomModelData(file, 1024 * 1024);
		expect(data.__modelEvalRuntime?.format).toBe('model_eval_json_v1');
		expect(data.entities).toBeUndefined();
		const parsed = parseBomModelJson(data, file.name);
		expect(parsed.runtimeScene?.format).toBe('model_eval_json_v1');
		expect(parsed.faces).toHaveLength(1);
		expect(parsed.faces[0].sourceFaceIds).toEqual(['face:1']);
		expect(parsed.faces[0].dominantOrientation).toBe('horizontal');
		expect(parsed.faceCount).toBe(1);
		expect(parsed.vertexCount).toBe(4);
		expect(parsed.bounds.size.x).toBeCloseTo(1, 5);
		expect(parsed.materials[0].color).toBe('#AA5522');
		expect(parsed.partStats.find((part) => part.key === 'floor')?.count).toBe(1);
	});

	test('rejects malformed table references before allocation', () => {
		const broken = structuredClone(example);
		broken.meshes[0].triangles[0] = 99;
		expect(() => parseModelEvalJsonV1(broken)).toThrow('triangle index');
	});
});
