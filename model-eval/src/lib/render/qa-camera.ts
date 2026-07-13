export type CameraPoint = { x: number; y: number; z: number };

export type SketchUpCameraCapture = {
	view_name: string;
	projection_mode: 'orthographic' | 'perspective';
	camera_position_m: CameraPoint;
	camera_target_m: CameraPoint;
	camera_up: CameraPoint;
	field_of_view_degrees: number | null;
	orthographic_height_m: number | null;
	aspect_ratio: number;
	viewport: { width: number; height: number };
};

export type QACameraSpec = {
	viewName: string;
	projectionMode: 'orthographic' | 'perspective';
	position: CameraPoint;
	target: CameraPoint;
	up: CameraPoint;
	fieldOfViewDegrees: number | null;
	orthographicHeightM: number | null;
	aspectRatio: number;
	viewport: { width: number; height: number };
	backgroundColor: string;
};

function finite(value: number, label: string) {
	if (!Number.isFinite(value)) throw new Error(`Invalid QA camera ${label}`);
	return value;
}

function mapSketchUpVector(point: CameraPoint): CameraPoint {
	return {
		x: finite(point.x, 'x'),
		y: finite(point.z, 'z'),
		z: -finite(point.y, 'y')
	};
}

export function sketchUpCaptureToThreeCamera(
	capture: SketchUpCameraCapture,
	backgroundColor = '#EEF2F0'
): QACameraSpec {
	const width = finite(capture.viewport.width, 'viewport width');
	const height = finite(capture.viewport.height, 'viewport height');
	const aspectRatio = finite(capture.aspect_ratio || width / height, 'aspect ratio');
	if (width <= 0 || height <= 0 || aspectRatio <= 0) throw new Error('Invalid QA camera viewport');
	if (capture.projection_mode === 'orthographic' && (!capture.orthographic_height_m || capture.orthographic_height_m <= 0)) {
		throw new Error('Orthographic QA camera requires a positive height');
	}
	if (capture.projection_mode === 'perspective' && (!capture.field_of_view_degrees || capture.field_of_view_degrees <= 0)) {
		throw new Error('Perspective QA camera requires a positive field of view');
	}

	return {
		viewName: capture.view_name,
		projectionMode: capture.projection_mode,
		position: mapSketchUpVector(capture.camera_position_m),
		target: mapSketchUpVector(capture.camera_target_m),
		up: mapSketchUpVector(capture.camera_up),
		fieldOfViewDegrees: capture.field_of_view_degrees,
		orthographicHeightM: capture.orthographic_height_m,
		aspectRatio,
		viewport: { width, height },
		backgroundColor: /^#[0-9A-F]{6}$/i.test(backgroundColor) ? backgroundColor : '#EEF2F0'
	};
}
