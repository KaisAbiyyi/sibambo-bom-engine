import { describe, expect, test } from 'bun:test';
import { createDefaultProjectConfiguration, exportProjectConfiguration, importProjectConfiguration, resetProjectConfigurationField, toRoomAnalysisConfiguration, updateProjectConfiguration, validateProjectConfiguration } from './project-configuration';

describe('project configuration', () => {
	test('default valid and immutable updates', () => { const base = createDefaultProjectConfiguration(); const next = updateProjectConfiguration(base, 'defaultWallUValue', 1.2); expect(validateProjectConfiguration(base).ok).toBe(true); expect(base.values.defaultWallUValue.value).toBe(2.8); expect(next.values.defaultWallUValue.source).toBe('user'); });
	test('invalid numeric value blocks analysis config', () => { const invalid = updateProjectConfiguration(createDefaultProjectConfiguration(), 'coefficientOfUtilization', 2); expect(validateProjectConfiguration(invalid).ok).toBe(false); expect(() => toRoomAnalysisConfiguration(invalid)).toThrow(); });
	test('field reset and JSON round trip', () => { const changed = updateProjectConfiguration(createDefaultProjectConfiguration(), 'ottvThresholdWm2', 45); const reset = resetProjectConfigurationField(changed, 'ottvThresholdWm2'); expect(reset.values.ottvThresholdWm2.value).toBe(35); expect(importProjectConfiguration(exportProjectConfiguration(changed))).toEqual({ ok: true, value: changed }); });
	test('rejects unsupported schema', () => { const raw = JSON.parse(exportProjectConfiguration(createDefaultProjectConfiguration())); raw.schema = 'other'; expect(importProjectConfiguration(JSON.stringify(raw)).ok).toBe(false); });
});
