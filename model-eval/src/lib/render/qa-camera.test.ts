import { describe, expect, test } from 'bun:test';
import { sketchUpCaptureToThreeCamera } from './qa-camera';

describe('SketchUp matched-view camera conversion', () => {
	test('maps SketchUp axes and orthographic framing into Three.js', () => {
		const camera = sketchUpCaptureToThreeCamera(
			{
				view_name: 'front',
				projection_mode: 'orthographic',
				camera_position_m: { x: 3, y: -20, z: 4 },
				camera_target_m: { x: 3, y: 2, z: 4 },
				camera_up: { x: 0, y: 0, z: 1 },
				field_of_view_degrees: null,
				orthographic_height_m: 8,
				aspect_ratio: 2,
				viewport: { width: 1982, height: 991 }
			},
			'#D2D0B9'
		);

		expect(camera).toEqual({
			viewName: 'front',
			projectionMode: 'orthographic',
			position: { x: 3, y: 4, z: 20 },
			target: { x: 3, y: 4, z: -2 },
			up: { x: 0, y: 1, z: -0 },
			fieldOfViewDegrees: null,
			orthographicHeightM: 8,
			aspectRatio: 2,
			viewport: { width: 1982, height: 991 },
			backgroundColor: '#D2D0B9'
		});
	});

	test('rejects an invalid orthographic framing height', () => {
		expect(() =>
			sketchUpCaptureToThreeCamera({
				view_name: 'bad',
				projection_mode: 'orthographic',
				camera_position_m: { x: 0, y: 0, z: 1 },
				camera_target_m: { x: 0, y: 0, z: 0 },
				camera_up: { x: 0, y: 1, z: 0 },
				field_of_view_degrees: null,
				orthographic_height_m: null,
				aspect_ratio: 1,
				viewport: { width: 100, height: 100 }
			})
		).toThrow('Orthographic QA camera requires a positive height');
	});
});
