import { describe, expect, test } from 'bun:test';
import Ajv2020 from 'ajv/dist/2020.js';

const schemaUrl = new URL('../../../../bom_engine_plugin/schema/bom-engine-3.0.schema.json', import.meta.url);
const exampleUrl = new URL('../../../../bom_engine_plugin/examples/canonical-v3-small.json', import.meta.url);

describe('canonical JSON v3 schema', () => {
	test('validates the documented example', async () => {
		const schema = await Bun.file(schemaUrl).json();
		const example = await Bun.file(exampleUrl).json();
		const validator = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true }).compile(schema);
		expect(validator(example), JSON.stringify(validator.errors, null, 2)).toBe(true);
	});

	test('rejects malformed transforms and dangling face indices', async () => {
		const schema = await Bun.file(schemaUrl).json();
		const example = await Bun.file(exampleUrl).json();
		const validator = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true }).compile(schema);
		const malformed = structuredClone(example);
		malformed.transforms[0] = [1, 0, 0];
		malformed.meshes[0].faces[0].outer = [0, -1, 999];
		expect(validator(malformed)).toBe(false);
		expect(validator.errors?.some((error) => error.instancePath.includes('/transforms/0'))).toBe(true);
		expect(validator.errors?.some((error) => error.instancePath.includes('/outer'))).toBe(true);
	});
});
