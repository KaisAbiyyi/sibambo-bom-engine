/**
 * human-flow.ts
 *
 * Human movement and spatial flow calculation using RoomTopologyGraph.
 * Calculates connection degree, accessibility, circulation likelihood, shortest paths,
 * dead-end indicators, decision points, and movement scores.
 */

import type { RoomTopologyGraph } from '../topology';
import type { RoomAnalysisInput, HumanFlowResult, AnalysisValue } from './types';

function computeConnectedComponents(topology: RoomTopologyGraph): Map<string, number> {
	const componentMap = new Map<string, number>();
	let currentComponent = 0;

	const adjMap = new Map<string, string[]>();
	for (const node of topology.rooms) {
		adjMap.set(node.roomId, []);
	}
	for (const conn of topology.connections) {
		if (conn.traversable) {
			adjMap.get(conn.fromRoomId)?.push(conn.toRoomId);
			adjMap.get(conn.toRoomId)?.push(conn.fromRoomId);
		}
	}

	for (const node of topology.rooms) {
		if (!componentMap.has(node.roomId)) {
			currentComponent++;
			const queue = [node.roomId];
			componentMap.set(node.roomId, currentComponent);
			while (queue.length > 0) {
				const curr = queue.shift()!;
				const neighbors = adjMap.get(curr) || [];
				for (const nxt of neighbors) {
					if (!componentMap.has(nxt)) {
						componentMap.set(nxt, currentComponent);
						queue.push(nxt);
					}
				}
			}
		}
	}
	return componentMap;
}

function computeShortestTopologicalPathToExit(
	roomId: string,
	topology: RoomTopologyGraph,
	exitRoomIds: Set<string>
): number | undefined {
	if (exitRoomIds.has(roomId)) return 0;
	if (exitRoomIds.size === 0) return undefined;

	const adjMap = new Map<string, string[]>();
	for (const node of topology.rooms) {
		adjMap.set(node.roomId, []);
	}
	for (const conn of topology.connections) {
		if (conn.traversable) {
			adjMap.get(conn.fromRoomId)?.push(conn.toRoomId);
			adjMap.get(conn.toRoomId)?.push(conn.fromRoomId);
		}
	}

	const visited = new Set<string>([roomId]);
	const queue: { id: string; dist: number }[] = [{ id: roomId, dist: 0 }];

	while (queue.length > 0) {
		const { id, dist } = queue.shift()!;
		const neighbors = adjMap.get(id) || [];
		for (const nxt of neighbors) {
			if (exitRoomIds.has(nxt)) {
				return dist + 1;
			}
			if (!visited.has(nxt)) {
				visited.add(nxt);
				queue.push({ id: nxt, dist: dist + 1 });
			}
		}
	}
	return undefined;
}

export function calculateHumanFlow(
	input: RoomAnalysisInput,
	allInputs: RoomAnalysisInput[],
	topology: RoomTopologyGraph
): HumanFlowResult {
	const majorConstraints: string[] = [];
	const evidence: string[] = [];
	const diagnostics: string[] = [];
	const warnings: string[] = [];

	if (!Number.isFinite(input.geometry.floorArea) || input.geometry.floorArea < 0 || !Number.isFinite(input.geometry.minWidth)) {
		warnings.push('Non-finite or negative room dimensions in flow calculation');
	}

	const componentMap = computeConnectedComponents(topology);
	const connectedComponentId = componentMap.get(input.room.id) || 1;

	// Identify exit or circulation hub rooms (rooms with exterior doors or corridor/staircase function)
	const exitRoomIds = new Set<string>();
	for (const inp of allInputs) {
		const hasExtDoor = inp.openings.some((o) => o.isExterior && o.type === 'door');
		if (hasExtDoor || inp.assumptions.usageProfile.function === 'corridor' || inp.assumptions.usageProfile.function === 'staircase') {
			exitRoomIds.add(inp.room.id);
		}
	}

	const shortestDist = computeShortestTopologicalPathToExit(input.room.id, topology, exitRoomIds);

	const topologyNode = input.topologyNode;
	let connectionDegree = 0;
	let accessibleNeighborCount = 0;
	let entranceCount = 0;

	if (topologyNode) {
		connectionDegree = topologyNode.connectionIds.length + topologyNode.exteriorConnectionIds.length;
	}

	// Count traversable openings
	for (const o of input.openings) {
		if (o.type === 'door' || o.type === 'open_passage') {
			accessibleNeighborCount++;
			if (o.isExterior || (o.connectedRoomId && exitRoomIds.has(o.connectedRoomId))) {
				entranceCount++;
			}
		}
	}

	const isIsolated = accessibleNeighborCount === 0;
	const isDeadEnd = accessibleNeighborCount === 1 && !input.openings.some((o) => o.isExterior && o.type === 'door');
	const isDecisionPoint = accessibleNeighborCount >= 3;

	let accessibilityStatus: 'accessible' | 'dead_end' | 'isolated' | 'unreachable' = 'accessible';
	if (isIsolated) {
		accessibilityStatus = 'isolated';
		majorConstraints.push('Room has no traversable doors or openings (isolated space)');
	} else if (isDeadEnd) {
		accessibilityStatus = 'dead_end';
		evidence.push('Room is a dead-end space with exactly 1 access point');
	}

	if (shortestDist === undefined && !isIsolated) {
		accessibilityStatus = 'unreachable';
		majorConstraints.push('No topological circulation path to an exterior exit or corridor');
	}

	// Circulation likelihood score (0 to 1)
	let circLikelihood = 0.2;
	if (input.assumptions.usageProfile.function === 'corridor' || input.assumptions.usageProfile.function === 'staircase') {
		circLikelihood = 0.95;
	} else if (isDecisionPoint) {
		circLikelihood = 0.7;
	} else if (isDeadEnd || isIsolated) {
		circLikelihood = 0.05;
	}

	// Estimated circulation width
	const minOpeningWidth = input.openings
		.filter((o) => o.type === 'door' || o.type === 'open_passage')
		.reduce((min, o) => Math.min(min, o.width), input.geometry.minWidth);

	const estimatedCirculationWidthM: AnalysisValue<number> = {
		value: Math.round(minOpeningWidth * 100) / 100,
		state: 'calculated',
		source: ['model', 'room_inference'],
		confidence: 0.8,
		diagnostics: []
	};

	if (minOpeningWidth < 0.75 && !isIsolated) {
		majorConstraints.push(`Narrow access or bottleneck width detected (${minOpeningWidth.toFixed(2)} m)`);
	}

	// Movement score (0 to 100)
	let score = Math.round(Math.min(100, (accessibleNeighborCount * 20 + circLikelihood * 40 + (isDeadEnd ? 0 : 20))));
	if (isIsolated) score = 0;

	return {
		connectionDegree,
		accessibleNeighborCount,
		circulationLikelihood: {
			value: circLikelihood,
			state: 'calculated',
			source: ['room_inference'],
			confidence: 0.85,
			diagnostics: []
		},
		isDeadEnd,
		isIsolated,
		entranceCount,
		estimatedCirculationWidthM,
		connectedComponentId,
		shortestPathDistanceToExit: shortestDist !== undefined ? {
			value: shortestDist,
			state: 'calculated',
			source: ['room_inference'],
			confidence: 0.9,
			diagnostics: [`Topological steps to circulation/exit: ${shortestDist}`]
		} : undefined,
		isDecisionPoint,
		movementScore: {
			value: score,
			state: 'calculated',
			source: ['room_inference'],
			confidence: 0.85,
			diagnostics: []
		},
		accessibilityStatus,
		majorConstraints,
		evidence,
		diagnostics,
		trace: {
			method: 'Topological Graph Analysis & Movement Scoring',
			formula: 'MovementScore = min(100, accessibleNeighbors * 20 + circLikelihood * 40 + (isDeadEnd ? 0 : 20))',
			inputs: [
				{ name: 'Accessible Neighbors', value: accessibleNeighborCount, unit: 'count' },
				{ name: 'Entrance Count', value: entranceCount, unit: 'count' },
				{ name: 'Connection Degree', value: connectionDegree, unit: 'count' },
				{ name: 'Floor Area', value: input.geometry.floorArea, unit: 'm²' }
			],
			intermediateValues: [
				{ name: 'Circulation Likelihood', value: circLikelihood, unit: 'ratio (0-1)' },
				{ name: 'Shortest Steps to Exit', value: shortestDist ?? 'unreachable', unit: 'steps' },
				{ name: 'Min Circulation Width', value: Math.round(minOpeningWidth * 100) / 100, unit: 'm' }
			],
			assumptions: ['Topological paths assume traversable doors and open passages'],
			finalResult: { value: score, unit: 'score (0-100)' },
			confidence: 0.85,
			warnings
		}
	};
}
