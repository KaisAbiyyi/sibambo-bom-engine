export const RULE_BANK_VERSION = 'building-classifier-rules/1.0.0';

export const BUILDING_CATEGORIES = [
	'roof',
	'floor',
	'ceiling',
	'exterior_wall',
	'interior_wall',
	'door',
	'window',
	'column',
	'beam',
	'stair',
	'railing',
	'furniture',
	'fixture',
	'opening',
	'room_boundary',
	'unknown'
] as const;

export type BuildingCategory = (typeof BUILDING_CATEGORIES)[number];

export type EvidenceWeight = { key: string; weight: number };

export type ClassificationRule = {
	id: string;
	target: Exclude<BuildingCategory, 'unknown'>;
	requiredAll?: string[];
	requiredAny?: string[];
	positive: EvidenceWeight[];
	negative?: EvidenceWeight[];
	baseScore?: number;
	confidenceThreshold: number;
	explanation: string;
};

const explicit = (
	id: string,
	target: Exclude<BuildingCategory, 'unknown'>,
	labelKey: string,
	extra: EvidenceWeight[],
	explanation: string
): ClassificationRule => ({
	id,
	target,
	requiredAny: [labelKey],
	positive: [{ key: labelKey, weight: 0.78 }, ...extra],
	negative: [{ key: 'label.conflict', weight: 0.22 }],
	baseScore: 0.08,
	confidenceThreshold: 0.55,
	explanation
});

export const RULE_BANK_V1: ClassificationRule[] = [
	explicit('R-ROOF-EXPLICIT-001', 'roof', 'label.roof', [{ key: 'surface.roof', weight: 0.14 }, { key: 'elevation.top', weight: 0.08 }], 'Explicit multilingual roof label reinforced by roof orientation or top elevation.'),
	{
		id: 'R-ROOF-GEOMETRY-002', target: 'roof', requiredAny: ['surface.roof'],
		positive: [{ key: 'surface.roof', weight: 0.62 }, { key: 'elevation.top', weight: 0.18 }, { key: 'material.roofing', weight: 0.18 }],
		negative: [{ key: 'material.glass', weight: 0.35 }], confidenceThreshold: 0.58,
		explanation: 'Sloped/top building geometry with roofing material is a roof candidate.'
	},
	explicit('R-FLOOR-EXPLICIT-001', 'floor', 'label.floor', [{ key: 'surface.floor', weight: 0.14 }, { key: 'elevation.floor_level', weight: 0.08 }], 'Explicit floor/slab label reinforced by horizontal geometry and storey elevation.'),
	{
		id: 'R-FLOOR-GEOMETRY-002', target: 'floor', requiredAll: ['surface.floor'],
		positive: [{ key: 'surface.floor', weight: 0.55 }, { key: 'elevation.floor_level', weight: 0.22 }, { key: 'geometry.large', weight: 0.12 }],
		negative: [{ key: 'label.ceiling', weight: 0.45 }, { key: 'elevation.top', weight: 0.12 }], confidenceThreshold: 0.58,
		explanation: 'Large upward horizontal face aligned with a detected storey level is floor/slab.'
	},
	{
		id: 'R-FLOOR-MATERIAL-003', target: 'floor', requiredAll: ['legacy.floor', 'orientation.horizontal'],
		positive: [{ key: 'legacy.floor', weight: 0.36 }, { key: 'material.flooring', weight: 0.22 }, { key: 'elevation.floor_level', weight: 0.18 }, { key: 'geometry.large', weight: 0.08 }],
		negative: [{ key: 'material.ceiling', weight: 0.45 }], baseScore: 0.08, confidenceThreshold: 0.58,
		explanation: 'Legacy horizontal face remains floor when flooring material or storey elevation supports it.'
	},
	explicit('R-CEILING-EXPLICIT-001', 'ceiling', 'label.ceiling', [{ key: 'surface.ceiling', weight: 0.14 }, { key: 'context.interior', weight: 0.06 }], 'Explicit ceiling/plafon label reinforced by interior horizontal geometry.'),
	{
		id: 'R-CEILING-GEOMETRY-002', target: 'ceiling', requiredAll: ['surface.ceiling'],
		positive: [{ key: 'surface.ceiling', weight: 0.56 }, { key: 'elevation.ceiling_height', weight: 0.2 }, { key: 'context.interior', weight: 0.1 }],
		negative: [{ key: 'label.roof', weight: 0.4 }, { key: 'elevation.top', weight: 0.1 }], confidenceThreshold: 0.58,
		explanation: 'Downward/interior horizontal face at typical room height is ceiling.'
	},
	{
		id: 'R-CEILING-MATERIAL-003', target: 'ceiling', requiredAll: ['legacy.ceiling', 'orientation.horizontal'],
		positive: [{ key: 'legacy.ceiling', weight: 0.36 }, { key: 'material.ceiling', weight: 0.22 }, { key: 'elevation.ceiling_height', weight: 0.18 }, { key: 'geometry.large', weight: 0.08 }],
		negative: [{ key: 'material.flooring', weight: 0.45 }], baseScore: 0.08, confidenceThreshold: 0.58,
		explanation: 'Legacy horizontal face remains ceiling when ceiling material or room-height evidence supports it.'
	},
	explicit('R-EXT-WALL-EXPLICIT-001', 'exterior_wall', 'label.exterior_wall', [{ key: 'orientation.vertical', weight: 0.1 }, { key: 'context.perimeter', weight: 0.08 }], 'Explicit exterior/facade wall label reinforced by vertical perimeter placement.'),
	{
		id: 'R-EXT-WALL-CONTEXT-002', target: 'exterior_wall', requiredAll: ['orientation.vertical', 'surface.wall'],
		positive: [{ key: 'surface.wall', weight: 0.3 }, { key: 'context.perimeter', weight: 0.28 }, { key: 'geometry.large', weight: 0.14 }, { key: 'label.wall', weight: 0.16 }, { key: 'material.masonry', weight: 0.1 }],
		negative: [{ key: 'label.interior_wall', weight: 0.55 }, { key: 'material.glass', weight: 0.22 }], confidenceThreshold: 0.6,
		explanation: 'Large vertical wall on building perimeter is exterior wall.'
	},
	{
		id: 'R-EXT-WALL-MIGRATION-003', target: 'exterior_wall', requiredAll: ['legacy.wall', 'orientation.vertical', 'context.perimeter'],
		positive: [{ key: 'legacy.wall', weight: 0.36 }, { key: 'orientation.vertical', weight: 0.2 }, { key: 'context.perimeter', weight: 0.2 }, { key: 'geometry.large', weight: 0.08 }],
		negative: [{ key: 'material.glass', weight: 0.3 }], baseScore: 0.08, confidenceThreshold: 0.58,
		explanation: 'Legacy wall geometry remains exterior only when vertical and on the building perimeter.'
	},
	explicit('R-INT-WALL-EXPLICIT-001', 'interior_wall', 'label.interior_wall', [{ key: 'orientation.vertical', weight: 0.1 }, { key: 'context.interior', weight: 0.08 }], 'Explicit partition/interior-wall label reinforced by vertical interior placement.'),
	{
		id: 'R-INT-WALL-CONTEXT-002', target: 'interior_wall', requiredAll: ['orientation.vertical', 'surface.wall'],
		positive: [{ key: 'surface.wall', weight: 0.3 }, { key: 'context.interior', weight: 0.28 }, { key: 'geometry.large', weight: 0.12 }, { key: 'label.wall', weight: 0.14 }],
		negative: [{ key: 'label.exterior_wall', weight: 0.55 }, { key: 'context.perimeter', weight: 0.2 }, { key: 'material.glass', weight: 0.35 }], confidenceThreshold: 0.6,
		explanation: 'Vertical wall away from the facade perimeter is interior wall/partition.'
	},
	{
		id: 'R-INT-WALL-MIGRATION-003', target: 'interior_wall', requiredAll: ['legacy.wall', 'orientation.vertical', 'context.interior'],
		positive: [{ key: 'legacy.wall', weight: 0.36 }, { key: 'orientation.vertical', weight: 0.2 }, { key: 'context.interior', weight: 0.2 }, { key: 'geometry.large', weight: 0.08 }],
		negative: [{ key: 'material.glass', weight: 0.3 }], baseScore: 0.08, confidenceThreshold: 0.58,
		explanation: 'Legacy wall geometry remains interior only when vertical and away from the perimeter.'
	},
	explicit('R-DOOR-EXPLICIT-001', 'door', 'label.door', [{ key: 'orientation.vertical', weight: 0.08 }, { key: 'geometry.opening_sized', weight: 0.07 }, { key: 'elevation.touches_floor', weight: 0.07 }], 'Explicit door/pintu label reinforced by opening size and floor contact.'),
	{
		id: 'R-DOOR-HOST-002', target: 'door', requiredAll: ['orientation.vertical', 'geometry.opening_sized', 'elevation.touches_floor'],
		positive: [{ key: 'elevation.touches_floor', weight: 0.28 }, { key: 'context.wall_host', weight: 0.2 }, { key: 'material.wood', weight: 0.16 }, { key: 'reuse.repeated', weight: 0.08 }, { key: 'legacy.door', weight: 0.08 }],
		negative: [{ key: 'material.glass', weight: 0.18 }, { key: 'label.window', weight: 0.5 }], baseScore: 0.08, confidenceThreshold: 0.58,
		explanation: 'Wall-hosted vertical opening touching a floor with door proportions/material is door.'
	},
	explicit('R-WINDOW-EXPLICIT-001', 'window', 'label.window', [{ key: 'orientation.vertical', weight: 0.08 }, { key: 'material.glass', weight: 0.08 }, { key: 'elevation.above_floor', weight: 0.06 }], 'Explicit window/jendela/fenestration label reinforced by glass and sill elevation.'),
	{
		id: 'R-WINDOW-HOST-002', target: 'window', requiredAll: ['orientation.vertical', 'geometry.opening_sized', 'material.glass'],
		positive: [{ key: 'material.glass', weight: 0.34 }, { key: 'context.wall_host', weight: 0.2 }, { key: 'elevation.above_floor', weight: 0.16 }, { key: 'reuse.repeated', weight: 0.1 }, { key: 'legacy.window', weight: 0.06 }],
		negative: [{ key: 'elevation.touches_floor', weight: 0.24 }, { key: 'label.door', weight: 0.5 }], baseScore: 0.06, confidenceThreshold: 0.58,
		explanation: 'Repeated glass opening above floor and hosted by a wall is window/fenestration.'
	},
	{
		id: 'R-WINDOW-CLUSTER-003', target: 'window', requiredAll: ['legacy.window', 'orientation.vertical', 'geometry.opening_sized'],
		positive: [{ key: 'legacy.window', weight: 0.4 }, { key: 'geometry.opening_sized', weight: 0.18 }, { key: 'material.wood', weight: 0.08 }, { key: 'material.glass', weight: 0.12 }, { key: 'elevation.above_floor', weight: 0.08 }],
		negative: [{ key: 'elevation.touches_floor', weight: 0.16 }, { key: 'label.door', weight: 0.45 }], baseScore: 0.12, confidenceThreshold: 0.58,
		explanation: 'Legacy opening cluster remains window only with vertical opening geometry and frame/glass evidence.'
	},
	{
		id: 'R-WINDOW-FRAME-004', target: 'window', requiredAll: ['orientation.vertical', 'shape.thin_frame', 'context.opening_cluster'],
		positive: [{ key: 'context.opening_cluster', weight: 0.36 }, { key: 'shape.thin_frame', weight: 0.24 }, { key: 'material.wood', weight: 0.1 }, { key: 'material.metal', weight: 0.1 }, { key: 'legacy.window', weight: 0.08 }],
		negative: [{ key: 'label.door', weight: 0.4 }], baseScore: 0.08, confidenceThreshold: 0.58,
		explanation: 'Thin frame adjacent to a window/glass anchor belongs to the window assembly.'
	},
	explicit('R-COLUMN-EXPLICIT-001', 'column', 'label.column', [{ key: 'shape.tall_slender', weight: 0.12 }, { key: 'material.structural', weight: 0.07 }], 'Explicit column/kolom/pillar label reinforced by tall slender structural geometry.'),
	{
		id: 'R-COLUMN-SHAPE-002', target: 'column', requiredAll: ['shape.tall_slender'],
		positive: [{ key: 'shape.tall_slender', weight: 0.48 }, { key: 'material.structural', weight: 0.24 }, { key: 'reuse.repeated', weight: 0.12 }, { key: 'legacy.structure', weight: 0.08 }],
		negative: [{ key: 'material.glass', weight: 0.3 }], confidenceThreshold: 0.62,
		explanation: 'Repeated tall slender structural element is column.'
	},
	explicit('R-BEAM-EXPLICIT-001', 'beam', 'label.beam', [{ key: 'shape.long_horizontal', weight: 0.12 }, { key: 'material.structural', weight: 0.07 }], 'Explicit beam/balok/girder label reinforced by long horizontal structural geometry.'),
	{
		id: 'R-BEAM-SHAPE-002', target: 'beam', requiredAll: ['shape.long_horizontal'],
		positive: [{ key: 'shape.long_horizontal', weight: 0.48 }, { key: 'material.structural', weight: 0.22 }, { key: 'elevation.above_floor', weight: 0.1 }, { key: 'legacy.structure', weight: 0.08 }],
		negative: [{ key: 'surface.floor', weight: 0.2 }], confidenceThreshold: 0.62,
		explanation: 'Long shallow structural element above floor is beam.'
	},
	explicit('R-STAIR-EXPLICIT-001', 'stair', 'label.stair', [{ key: 'reuse.repeated', weight: 0.08 }, { key: 'shape.stepped_volume', weight: 0.08 }], 'Explicit stair/tangga/step label reinforced by repeated stepped geometry.'),
	{
		id: 'R-STAIR-PATTERN-002', target: 'stair', requiredAll: ['shape.stepped_volume', 'reuse.repeated'],
		positive: [{ key: 'shape.stepped_volume', weight: 0.42 }, { key: 'reuse.repeated', weight: 0.22 }, { key: 'context.interior', weight: 0.1 }], confidenceThreshold: 0.64,
		explanation: 'Repeated faces spanning a stepped vertical volume indicate stair.'
	},
	explicit('R-RAILING-EXPLICIT-001', 'railing', 'label.railing', [{ key: 'shape.thin_linear', weight: 0.12 }, { key: 'material.metal', weight: 0.06 }], 'Explicit railing/handrail/pagar label reinforced by thin linear geometry.'),
	{
		id: 'R-RAILING-SHAPE-002', target: 'railing', requiredAll: ['shape.thin_linear', 'reuse.repeated'],
		positive: [{ key: 'shape.thin_linear', weight: 0.42 }, { key: 'reuse.repeated', weight: 0.2 }, { key: 'material.metal', weight: 0.15 }], confidenceThreshold: 0.64,
		explanation: 'Repeated thin linear metal geometry is railing.'
	},
	explicit('R-FURNITURE-EXPLICIT-001', 'furniture', 'label.furniture', [{ key: 'context.interior', weight: 0.07 }, { key: 'reuse.repeated', weight: 0.06 }], 'Explicit furniture/object label reinforced by interior placement or instance reuse.'),
	{
		id: 'R-FURNITURE-CONTEXT-002', target: 'furniture', requiredAll: ['geometry.small', 'reuse.repeated'],
		positive: [{ key: 'geometry.small', weight: 0.3 }, { key: 'reuse.repeated', weight: 0.25 }, { key: 'context.interior', weight: 0.16 }, { key: 'legacy.furniture', weight: 0.16 }], confidenceThreshold: 0.64,
		explanation: 'Repeated small interior object with furniture context is furniture.'
	},
	explicit('R-FIXTURE-EXPLICIT-001', 'fixture', 'label.fixture', [{ key: 'geometry.small', weight: 0.1 }, { key: 'context.interior', weight: 0.06 }], 'Explicit sanitary/MEP fixture label reinforced by compact interior geometry.'),
	{
		id: 'R-FIXTURE-CONTEXT-002', target: 'fixture', requiredAll: ['geometry.small'],
		positive: [{ key: 'geometry.small', weight: 0.3 }, { key: 'material.fixture', weight: 0.25 }, { key: 'reuse.repeated', weight: 0.14 }, { key: 'context.interior', weight: 0.12 }], confidenceThreshold: 0.65,
		explanation: 'Compact repeated sanitary/MEP object is fixture.'
	},
	explicit('R-OPENING-EXPLICIT-001', 'opening', 'label.opening', [{ key: 'geometry.opening_sized', weight: 0.1 }, { key: 'context.wall_host', weight: 0.06 }], 'Explicit opening/bukaan/void label reinforced by wall-host relationship.'),
	{
		id: 'R-OPENING-TOPOLOGY-002', target: 'opening', requiredAny: ['topology.hole'],
		positive: [{ key: 'topology.hole', weight: 0.5 }, { key: 'context.wall_host', weight: 0.2 }, { key: 'geometry.opening_sized', weight: 0.12 }],
		negative: [{ key: 'material.glass', weight: 0.2 }, { key: 'material.wood', weight: 0.15 }], confidenceThreshold: 0.62,
		explanation: 'Topological void hosted by a wall is opening.'
	},
	explicit('R-ROOM-BOUNDARY-EXPLICIT-001', 'room_boundary', 'label.room_boundary', [{ key: 'surface.floor', weight: 0.08 }, { key: 'geometry.large', weight: 0.07 }], 'Explicit room/space boundary label reinforced by large horizontal enclosure geometry.'),
	{
		id: 'R-ROOM-BOUNDARY-GEOMETRY-002', target: 'room_boundary', requiredAll: ['surface.floor', 'geometry.room_sized'],
		positive: [{ key: 'geometry.room_sized', weight: 0.38 }, { key: 'context.interior', weight: 0.18 }, { key: 'topology.enclosed_polygon', weight: 0.16 }],
		negative: [{ key: 'label.floor', weight: 0.2 }], confidenceThreshold: 0.66,
		explanation: 'Large enclosed interior floor polygon is a room-boundary candidate.'
	}
];
