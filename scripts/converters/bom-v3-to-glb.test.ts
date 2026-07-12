import { describe, expect, test } from 'bun:test';
import { convertCanonicalToGlb } from './bom-v3-to-glb';

const exampleUrl = new URL('../../bom_engine_plugin/examples/canonical-v3-small.json', import.meta.url);

describe('canonical v3 to GLB converter', () => {
	test('writes a valid GLB 2 container with indexed mesh and traceable extras', async () => {
		const canonical = await Bun.file(exampleUrl).json();
		const glb = convertCanonicalToGlb(canonical);
		const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
		expect(view.getUint32(0, true)).toBe(0x46546c67);
		expect(view.getUint32(4, true)).toBe(2);
		expect(view.getUint32(8, true)).toBe(glb.byteLength);
		expect(view.getUint32(16, true)).toBe(0x4e4f534a);
		const jsonBytes = view.getUint32(12, true);
		const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonBytes)).trimEnd());
		expect(json.meshes).toHaveLength(1);
		expect(json.meshes[0].primitives[0].indices).toBeNumber();
		expect(json.extras.canonical_format_version).toBe('3.0.0');
		expect(json.extras.omitted_semantics).toContain('polygon_loops');
	});
});
