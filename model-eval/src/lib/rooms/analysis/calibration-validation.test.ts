import { describe, expect, test } from 'bun:test';
import { buildCalibrationValidationSummary, filterCalibrationWarnings } from './calibration-validation';
import { createDefaultProjectConfiguration, updateProjectConfiguration } from './project-configuration';

const analysis: any = { rooms: [
	{ roomId: 'r1', dataQuality: 'complete', diagnostics: [{ module: 'thermal', message: 'Missing opening data', severity: 'warning' }] },
	{ roomId: 'r2', dataQuality: 'partial', diagnostics: [{ module: 'adapter', message: 'Room geometry inputs insufficient', severity: 'error' }] },
	{ roomId: 'r3', dataQuality: 'insufficient', diagnostics: [] }
], ottv: { missingInputs: ['Material data unavailable'] }, diagnostics: [{ message: 'Project North unresolved' }] };

describe('calibration validation summary', () => {
	test('summarizes quality, fallback and filtered warnings', () => { const summary = buildCalibrationValidationSummary(createDefaultProjectConfiguration(), analysis); expect(summary.roomCounts).toEqual({ complete: 1, partial: 1, insufficient: 1 }); expect(filterCalibrationWarnings(summary, 'r1', 'thermal')).toHaveLength(1); expect(summary.warnings.some(w => w.category === 'material')).toBe(true); });
	test('invalid configuration is visible before analysis apply', () => { const config = updateProjectConfiguration(createDefaultProjectConfiguration(), 'ottvThresholdWm2', 999); expect(buildCalibrationValidationSummary(config, analysis).configurationValid).toBe(false); });
});
