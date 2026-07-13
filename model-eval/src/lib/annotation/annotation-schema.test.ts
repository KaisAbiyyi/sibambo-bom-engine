import { expect, test } from 'bun:test';
import Ajv2020 from 'ajv/dist/2020.js';

const schemaUrl = new URL('../../../schemas/tier1-surface-ground-truth.schema.json', import.meta.url);
const trainUrl = new URL('../../../tests/fixtures/tier1-surface-train.json', import.meta.url);

test('Tier-1 annotation schema accepts dataset fixture and rejects invalid concrete role', async () => {
	const schema = await Bun.file(schemaUrl).json();
	const fixture = await Bun.file(trainUrl).json();
	const validator = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
	expect(validator(fixture), JSON.stringify(validator.errors)).toBe(true);
	const invalid = structuredClone(fixture);
	invalid.annotations = [{ modelId: 'm', sourceExportHash: 'h', classificationUnitId: 'u', logicalObjectId: 'o', surfaceClusterIds: [], expectedSurfaceRole: 'door', status: 'verified', annotationConfidence: 'high', evidenceNote: '', sourceLabelReliability: 'absent', screenshotReferences: [], annotatedAt: 'now', reviewer: 'r', split: 'train' }];
	expect(validator(invalid)).toBe(false);
});
