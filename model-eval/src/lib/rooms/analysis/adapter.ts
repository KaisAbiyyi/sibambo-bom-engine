/**
 * adapter.ts
 *
 * Transforms DetectedRoom, RoomTopologyGraph, and RoomSemanticInference into
 * clean, analysis-ready RoomAnalysisInput structures.
 */

import type { DetectedRoom, Point3D } from '../detected-room';
import type { RoomTopologyGraph, RoomConnection, SharedRoomBoundary, ExteriorRoomConnection } from '../topology';
import type { RoomSemanticInference } from '../semantics';
import { getRoomUsageProfile } from './profiles';
import {
	DEFAULT_ANALYSIS_CONFIGURATION,
	type RoomAnalysisConfiguration,
	type RoomAnalysisInput,
	type RoomGeometryAnalysisInput,
	type RoomOpeningAnalysisInput,
	type RoomEnvelopeSurfaceInput,
	type RoomComponentEvidence,
	type RoomAnalysisAssumptions,
	type RoomAnalysisDataQuality,
	type AnalysisValue
} from './types';

function computeOrientationDeg(p1: { x: number; z: number }, p2: { x: number; z: number }): number {
	const dx = p2.x - p1.x;
	const dz = p2.z - p1.z;
	// Normal pointing to the right of segment (p1->p2) in XZ
	const nx = dz;
	const nz = -dx;
	// Angle 0 = North (+Z), 90 = East (+X), 180 = South (-Z), 270 = West (-X)
	let angleDeg = Math.atan2(nx, nz) * (180 / Math.PI);
	if (angleDeg < 0) angleDeg += 360;
	return angleDeg;
}

export function buildRoomAnalysisInputs(
	rooms: DetectedRoom[],
	topology: RoomTopologyGraph,
	semantics: RoomSemanticInference[],
	configOverrides?: Partial<RoomAnalysisConfiguration>
): RoomAnalysisInput[] {
	const config: RoomAnalysisConfiguration = {
		...DEFAULT_ANALYSIS_CONFIGURATION,
		...(configOverrides || {})
	};

	return rooms.map((room) => {
		const topologyNode = (topology.rooms || []).find((n) => n.roomId === room.id);
		const semantic = semantics.find((s) => s.roomId === room.id);
		const usageProfile = getRoomUsageProfile(semantic?.primaryFunction);

		// 1. Geometry
		const minX = room.planBounds.min.x;
		const maxX = room.planBounds.max.x;
		const minZ = room.planBounds.min.z;
		const maxZ = room.planBounds.max.z;
		const spanX = Math.max(0.01, maxX - minX);
		const spanZ = Math.max(0.01, maxZ - minZ);
		const aspectRatio = Math.max(spanX, spanZ) / Math.min(spanX, spanZ);
		const minWidth = Math.min(spanX, spanZ);

		const geometry: RoomGeometryAnalysisInput = {
			floorArea: room.floorArea,
			perimeter: room.perimeter,
			height: room.height,
			volume: room.estimatedVolume,
			centroid: room.centroid,
			boundingBox: {
				min: { x: minX, y: room.floorElevation, z: minZ },
				max: { x: maxX, y: room.ceilingElevation, z: maxZ }
			},
			aspectRatio,
			minWidth
		};

		// 2. Openings
		const openings: RoomOpeningAnalysisInput[] = [];

		// Interior connections
		for (const conn of (topology.connections || [])) {
			if (conn.fromRoomId === room.id || conn.toRoomId === room.id) {
				const isFrom = conn.fromRoomId === room.id;
				const otherRoomId = isFrom ? conn.toRoomId : conn.fromRoomId;
				let orientationDeg: number | undefined = undefined;
				if (conn.evidence?.segment) {
					orientationDeg = computeOrientationDeg(conn.evidence.segment.start, conn.evidence.segment.end);
				}

				openings.push({
					id: conn.id,
					type: conn.type === 'door' ? 'door' : conn.type === 'open_passage' ? 'open_passage' : 'window',
					area: (conn.width || 0.9) * Math.max(1.8, (conn.headElevation || 2.1) - (conn.sillElevation || 0)),
					width: conn.width || 0.9,
					height: Math.max(1.8, (conn.headElevation || 2.1) - (conn.sillElevation || 0)),
					sillElevation: conn.sillElevation || 0,
					headElevation: conn.headElevation || 2.1,
					isExterior: false,
					orientationDeg,
					connectedRoomId: otherRoomId
				});
			}
		}

		// Exterior connections
		for (const ext of topology.exteriorConnections) {
			if (ext.roomId === room.id) {
				let orientationDeg: number | undefined = undefined;
				if (ext.boundarySegment) {
					orientationDeg = computeOrientationDeg(ext.boundarySegment.start, ext.boundarySegment.end);
				}
				const width = ext.width || 1.2;
				const height = Math.max(1.2, (ext.headElevation || 2.1) - (ext.sillElevation || 0.9));
				openings.push({
					id: ext.id,
					type: ext.type === 'door' ? 'door' : ext.type === 'window' ? 'window' : 'window',
					area: width * height,
					width,
					height,
					sillElevation: ext.sillElevation || 0.9,
					headElevation: ext.headElevation || 2.1,
					isExterior: true,
					orientationDeg
				});
			}
		}

		// 3. Envelope surfaces
		const envelopeSurfaces: RoomEnvelopeSurfaceInput[] = [];

		// Shared interior boundaries
		for (const sb of (topology.sharedBoundaries || [])) {
			if (sb.roomAId === room.id || sb.roomBId === room.id) {
				const area = sb.length * room.height;
				envelopeSurfaces.push({
					id: sb.id,
					role: 'interior_wall',
					area,
					orientationDeg: computeOrientationDeg(sb.segment.start, sb.segment.end),
					uValue: {
						value: config.defaultWallUValue,
						state: 'assumption_dependent',
						source: ['user_config'],
						confidence: 0.7,
						diagnostics: []
					},
					solarAbsorptance: {
						value: config.defaultSolarAbsorptance,
						state: 'assumption_dependent',
						source: ['user_config'],
						confidence: 0.7,
						diagnostics: []
					},
					shadingCoefficient: {
						value: config.defaultShadingCoefficient,
						state: 'assumption_dependent',
						source: ['user_config'],
						confidence: 0.7,
						diagnostics: []
					},
					solarFactor: {
						value: config.defaultSolarFactor,
						state: 'assumption_dependent',
						source: ['user_config'],
						confidence: 0.7,
						diagnostics: []
					}
				});
			}
		}

		// Exterior wall boundary segments
		// Find boundary segments of this room that are not accounted for in sharedBoundaries
		const sharedSegmentIds = new Set(
			(topology.sharedBoundaries || [])
				.filter((sb) => sb.roomAId === room.id || sb.roomBId === room.id)
				.map((sb) => sb.segment.id)
		);

		if (room.evidence?.boundarySegments) {
			for (const seg of room.evidence.boundarySegments) {
				if (!sharedSegmentIds.has(seg.id) && seg.kind === 'wall') {
					const dx = seg.end.x - seg.start.x;
					const dz = seg.end.z - seg.start.z;
					const length = Math.sqrt(dx * dx + dz * dz);
					const area = length * room.height;
					if (area > 0.1) {
						envelopeSurfaces.push({
							id: seg.id,
							role: 'exterior_wall',
							area,
							orientationDeg: computeOrientationDeg(seg.start, seg.end),
							uValue: {
								value: config.defaultWallUValue,
								state: 'assumption_dependent',
								source: ['user_config'],
								confidence: 0.8,
								diagnostics: []
							},
							solarAbsorptance: {
								value: config.defaultSolarAbsorptance,
								state: 'assumption_dependent',
								source: ['user_config'],
								confidence: 0.8,
								diagnostics: []
							},
							shadingCoefficient: {
								value: config.defaultShadingCoefficient,
								state: 'assumption_dependent',
								source: ['user_config'],
								confidence: 0.8,
								diagnostics: []
							},
							solarFactor: {
								value: config.defaultSolarFactor,
								state: 'assumption_dependent',
								source: ['user_config'],
								confidence: 0.8,
								diagnostics: []
							}
						});
					}
				}
			}
		}

		// Floor and ceiling
		envelopeSurfaces.push({
			id: `${room.id}_floor`,
			role: 'floor',
			area: room.floorArea,
			uValue: {
				value: 2.5,
				state: 'assumption_dependent',
				source: ['standard_profile'],
				confidence: 0.7,
				diagnostics: []
			},
			solarAbsorptance: {
				value: 0.6,
				state: 'not_applicable',
				source: ['standard_profile'],
				confidence: 1.0,
				diagnostics: []
			},
			shadingCoefficient: {
				value: 1.0,
				state: 'not_applicable',
				source: ['standard_profile'],
				confidence: 1.0,
				diagnostics: []
			},
			solarFactor: {
				value: 1.0,
				state: 'not_applicable',
				source: ['standard_profile'],
				confidence: 1.0,
				diagnostics: []
			}
		});

		envelopeSurfaces.push({
			id: `${room.id}_ceiling`,
			role: 'ceiling',
			area: room.floorArea,
			uValue: {
				value: 1.8,
				state: 'assumption_dependent',
				source: ['standard_profile'],
				confidence: 0.7,
				diagnostics: []
			},
			solarAbsorptance: {
				value: 0.6,
				state: 'not_applicable',
				source: ['standard_profile'],
				confidence: 1.0,
				diagnostics: []
			},
			shadingCoefficient: {
				value: 1.0,
				state: 'not_applicable',
				source: ['standard_profile'],
				confidence: 1.0,
				diagnostics: []
			},
			solarFactor: {
				value: 1.0,
				state: 'not_applicable',
				source: ['standard_profile'],
				confidence: 1.0,
				diagnostics: []
			}
		});

		// 4. Components (evidence from semantics if available)
		const components: RoomComponentEvidence[] = [];
		if (semantic?.candidates && semantic.candidates.length > 0) {
			const primaryCandidate = semantic.candidates[0];
			if (primaryCandidate?.evidence?.objectScores) {
				for (const [objCategory, count] of Object.entries(primaryCandidate.evidence.objectScores)) {
					if (count > 0) {
						components.push({
							id: `${room.id}_obj_${objCategory}`,
							category: objCategory,
							count: Math.round(count)
						});
					}
				}
			}
		}

		// 5. Assumptions
		const estimatedOccupants = Math.max(1, Math.round(room.floorArea / Math.max(1, usageProfile.typicalOccupancyAreaPerPersonM2)));
		const occupantCount: AnalysisValue<number> = {
			value: estimatedOccupants,
			state: 'estimated',
			source: ['standard_profile'],
			confidence: semantic ? Math.min(semantic.confidence, 0.8) : 0.5,
			diagnostics: []
		};

		const assumptions: RoomAnalysisAssumptions = {
			usageProfile,
			indoorDesignTempC: config.indoorDesignTempC,
			outdoorDesignTempC: config.outdoorDesignTempC,
			relativeHumidityPercent: config.relativeHumidityPercent,
			airSpeedMs: 0.15, // typical indoor air movement
			clothingClo: usageProfile.clothingInsulationClo,
			metabolicRateMet: usageProfile.metabolicRateMet,
			localWindSpeedMs: config.localWindSpeedMs,
			localWindDirectionDeg: config.localWindDirectionDeg,
			occupantCount
		};

		// 6. Data Quality
		let dataQuality: RoomAnalysisDataQuality = 'complete';
		if (!topologyNode || !semantic || room.confidence?.level === 'low') {
			dataQuality = 'partial';
		}
		if (room.floorArea < 1.0 || room.height < 1.5) {
			dataQuality = 'insufficient';
		}

		return {
			room,
			topologyNode,
			semantic,
			geometry,
			openings,
			envelopeSurfaces,
			components,
			assumptions,
			dataQuality
		};
	});
}
