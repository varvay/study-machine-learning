import { Dot, Link, Plane, PlotCanvas, QueryMark, Ring, type DotTone, type LinkTone, type PlotPosition } from '../../src/explainer/scene';
import type { Step } from '../../src/explainer/types';

export type VectorId = string;

export interface Coordinates {
	x: number;
	y: number;
}

interface Vector extends Coordinates {
	id: VectorId;
	topLayer: number;
}

export interface LayerLink {
	layer: number;
	from: VectorId;
	to: VectorId;
}

interface HopEvent {
	kind: 'hop';
	layer: number;
	from: VectorId;
	to: VectorId;
	examined: VectorId[];
}

interface StayEvent {
	kind: 'stay';
	layer: number;
	at: VectorId;
	examined: VectorId[];
}

interface CandidatesEvent {
	kind: 'candidates';
	layer: number;
	start: VectorId;
	candidates: VectorId[];
}

interface LinkEvent {
	kind: 'link';
	layer: number;
	neighbors: VectorId[];
}

interface PruneEvent {
	kind: 'prune';
	layer: number;
	owner: VectorId;
	dropped: VectorId[];
}

type WalkEvent = HopEvent | StayEvent;
type InsertEvent = WalkEvent | CandidatesEvent | LinkEvent | PruneEvent;

interface ExaminedLinks {
	layer: number;
	from: VectorId;
	to: VectorId[];
}

export interface HnswStep extends Step {
	ringLayer: number;
	ringAt: VectorId;
	examined?: ExaminedLinks;
	candidates?: { layer: number; ids: VectorId[] };
	path: LayerLink[];
	addedLinks: LayerLink[];
	prunedLinks: LayerLink[];
	flashedLinks: LayerLink[];
	linkedLayers: number[];
	answer?: VectorId;
	trueNearest?: VectorId;
}

export const TOP_LAYER = 2;
export const LINKS_PER_INSERT = 2;
export const EF_CONSTRUCTION = 4;
export const NEW_VECTOR_ID = 'new';

export const maxLinksOn = (layer: number) => (layer === 0 ? 2 * LINKS_PER_INSERT : LINKS_PER_INSERT);

export const BASE_VECTORS: Vector[] = [
	{ id: 'A', x: 15, y: 20, topLayer: 2 },
	{ id: 'B', x: 80, y: 75, topLayer: 2 },
	{ id: 'C', x: 70, y: 20, topLayer: 1 },
	{ id: 'D', x: 25, y: 80, topLayer: 1 },
	{ id: 'E', x: 50, y: 45, topLayer: 1 },
	{ id: 'F', x: 35, y: 15, topLayer: 0 },
	{ id: 'G', x: 88, y: 35, topLayer: 0 },
	{ id: 'H', x: 60, y: 70, topLayer: 0 },
	{ id: 'J', x: 10, y: 50, topLayer: 0 },
	{ id: 'K', x: 40, y: 90, topLayer: 0 },
	{ id: 'M', x: 92, y: 90, topLayer: 0 },
	{ id: 'N', x: 55, y: 25, topLayer: 0 },
	{ id: 'P', x: 30, y: 55, topLayer: 0 },
	{ id: 'R', x: 75, y: 50, topLayer: 0 },
	{ id: 'S', x: 65, y: 92, topLayer: 0 },
	{ id: 'T', x: 20, y: 35, topLayer: 0 },
];

export const distance = (a: Coordinates, b: Coordinates) => Math.hypot(a.x - b.x, a.y - b.y);

export class HnswGraph {
	private readonly vectors = new Map<VectorId, Vector>();
	private readonly layers: Map<VectorId, Set<VectorId>>[] = [];
	private entryId?: VectorId;
	private topLayer = -1;

	static build(vectors: Vector[]) {
		const graph = new HnswGraph();
		vectors.forEach((vector) => graph.insert(vector));
		return graph;
	}

	clone() {
		const copy = new HnswGraph();
		this.vectors.forEach((vector, id) => copy.vectors.set(id, vector));
		this.layers.forEach((links, layer) => {
			copy.layers[layer] = new Map([...links].map(([id, neighbors]) => [id, new Set(neighbors)]));
		});
		copy.entryId = this.entryId;
		copy.topLayer = this.topLayer;
		return copy;
	}

	get entry() {
		return this.entryId!;
	}

	vector(id: VectorId) {
		return this.vectors.get(id)!;
	}

	allVectors() {
		return [...this.vectors.values()];
	}

	isOn(id: VectorId, layer: number) {
		return this.layers[layer]?.has(id) ?? false;
	}

	neighbors(id: VectorId, layer: number) {
		return [...(this.layers[layer]?.get(id) ?? [])];
	}

	linksOn(layer: number): LayerLink[] {
		return [...(this.layers[layer] ?? [])].flatMap(([from, neighbors]) =>
			[...neighbors].filter((to) => from < to).map((to) => ({ layer, from, to })),
		);
	}

	search(query: Coordinates) {
		const trace: WalkEvent[] = [];
		let current = this.entry;
		for (let layer = this.topLayer; layer >= 0; layer--) current = this.walkGreedily(query, current, layer, (event) => trace.push(event));
		return { trace, answer: current };
	}

	insert(vector: Vector): InsertEvent[] {
		this.vectors.set(vector.id, vector);
		for (let layer = 0; layer <= vector.topLayer; layer++) {
			this.layers[layer] ??= new Map();
			this.layers[layer].set(vector.id, new Set());
		}
		if (this.entryId === undefined) {
			this.entryId = vector.id;
			this.topLayer = vector.topLayer;
			return [];
		}

		const trace: InsertEvent[] = [];
		let start = this.entry;
		for (let layer = this.topLayer; layer > vector.topLayer; layer--) start = this.walkGreedily(vector, start, layer, (event) => trace.push(event));

		for (let layer = Math.min(this.topLayer, vector.topLayer); layer >= 0; layer--) {
			const candidates = this.closestFound(vector, start, EF_CONSTRUCTION, layer);
			trace.push({ kind: 'candidates', layer, start, candidates });
			const neighbors = candidates.slice(0, LINKS_PER_INSERT);
			neighbors.forEach((neighbor) => this.connect(vector.id, neighbor, layer));
			trace.push({ kind: 'link', layer, neighbors });
			for (const neighbor of neighbors) {
				const dropped = this.trimLinks(neighbor, layer);
				if (dropped.length > 0) trace.push({ kind: 'prune', layer, owner: neighbor, dropped });
			}
			start = candidates[0];
		}

		if (vector.topLayer > this.topLayer) {
			this.entryId = vector.id;
			this.topLayer = vector.topLayer;
		}
		return trace;
	}

	private distanceTo(query: Coordinates, id: VectorId) {
		return distance(query, this.vector(id));
	}

	private walkGreedily(query: Coordinates, start: VectorId, layer: number, record: (event: WalkEvent) => void) {
		let current = start;
		while (true) {
			const examined = this.neighbors(current, layer);
			const closest = [...examined].sort((a, b) => this.distanceTo(query, a) - this.distanceTo(query, b))[0];
			if (closest === undefined || this.distanceTo(query, closest) >= this.distanceTo(query, current)) {
				record({ kind: 'stay', layer, at: current, examined });
				return current;
			}
			record({ kind: 'hop', layer, from: current, to: closest, examined });
			current = closest;
		}
	}

	private closestFound(query: Coordinates, start: VectorId, limit: number, layer: number) {
		const byDistance = (a: VectorId, b: VectorId) => this.distanceTo(query, a) - this.distanceTo(query, b);
		const visited = new Set([start]);
		const toExpand = [start];
		let found = [start];
		while (toExpand.length > 0) {
			toExpand.sort(byDistance);
			const nearest = toExpand.shift()!;
			if (found.length >= limit && this.distanceTo(query, nearest) > this.distanceTo(query, found.at(-1)!)) break;
			for (const neighbor of this.neighbors(nearest, layer)) {
				if (visited.has(neighbor)) continue;
				visited.add(neighbor);
				toExpand.push(neighbor);
				found = [...found, neighbor].sort(byDistance).slice(0, limit);
			}
		}
		return found;
	}

	private connect(a: VectorId, b: VectorId, layer: number) {
		this.layers[layer].get(a)!.add(b);
		this.layers[layer].get(b)!.add(a);
	}

	private trimLinks(owner: VectorId, layer: number) {
		const ownerVector = this.vector(owner);
		const byDistance = this.neighbors(owner, layer).sort((a, b) => this.distanceTo(ownerVector, a) - this.distanceTo(ownerVector, b));
		const dropped = byDistance.slice(maxLinksOn(layer));
		for (const neighbor of dropped) {
			this.layers[layer].get(owner)!.delete(neighbor);
			this.layers[layer].get(neighbor)!.delete(owner);
		}
		return dropped;
	}
}

export const baseGraph = HnswGraph.build(BASE_VECTORS);

export const rounded = (value: number) => Math.round(value);
export const joinNames = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
export const sameLink = (a: LayerLink, b: LayerLink) =>
	a.layer === b.layer && ((a.from === b.from && a.to === b.to) || (a.from === b.to && a.to === b.from));

export function describeDistances(graph: HnswGraph, target: Coordinates, ids: VectorId[]) {
	return joinNames(ids.map((id) => `${id} (${rounded(distance(target, graph.vector(id)))})`));
}

export interface WalkNarrationContext {
	graph: HnswGraph;
	target: Coordinates;
	purpose: 'search' | 'insert';
}

export function walkNarration({ graph, target, purpose }: WalkNarrationContext, event: WalkEvent) {
	const here = event.kind === 'hop' ? event.from : event.at;
	const hereDistance = rounded(distance(target, graph.vector(here)));
	const neighbours = event.examined.length > 0 ? `${here}'s links go to ${describeDistances(graph, target, event.examined)}` : `${here} has no links here`;
	if (event.kind === 'hop')
		return `Layer ${event.layer}: ${neighbours}. ${event.to} is closer than ${here} (${hereDistance}), so hop to ${event.to}.`;
	const next = purpose === 'insert' ? 'the new vector' : 'the query';
	if (event.layer === 0) return `Layer 0: ${neighbours}. None is closer to ${next} than ${here} (${hereDistance}).`;
	return `Layer ${event.layer}: ${neighbours}. None is closer to ${next} than ${here} (${hereDistance}), so drop to layer ${event.layer - 1}, still at ${here}, where more vectors live.`;
}

interface StepState {
	path: LayerLink[];
	addedLinks: LayerLink[];
	prunedLinks: LayerLink[];
	flashedLinks: LayerLink[];
	linkedLayers: number[];
}

export const emptyState = (): StepState => ({ path: [], addedLinks: [], prunedLinks: [], flashedLinks: [], linkedLayers: [] });

const PLANE_WIDTH = 244;
const PLANE_HEIGHT = 214;
const PLANE_GAP = 24;
const PLANE_TOP = 26;
const PLANE_PADDING = 16;
const CANVAS_WIDTH = (TOP_LAYER + 1) * PLANE_WIDTH + TOP_LAYER * PLANE_GAP;
const CANVAS_HEIGHT = PLANE_TOP + PLANE_HEIGHT + 4;

const planeLeft = (layer: number) => (TOP_LAYER - layer) * (PLANE_WIDTH + PLANE_GAP);

const toPlane = (layer: number, point: Coordinates): PlotPosition => ({
	x: planeLeft(layer) + PLANE_PADDING + (point.x / 100) * (PLANE_WIDTH - 2 * PLANE_PADDING),
	y: PLANE_TOP + PLANE_PADDING + (point.y / 100) * (PLANE_HEIGHT - 2 * PLANE_PADDING),
});

const linkKey = (link: LayerLink) => `${link.layer}:${[link.from, link.to].sort().join('-')}`;

export interface LayersViewProps {
	target: Coordinates;
	targetLabel: string;
	showsNewVector: boolean;
	step: HnswStep;
}

export function LayersView({ target, targetLabel, showsNewVector, step }: LayersViewProps) {
	const graph = baseGraph;
	const positionOf = (id: VectorId, layer: number) => toPlane(layer, id === NEW_VECTOR_ID ? target : graph.vector(id));
	const has = (links: LayerLink[], link: LayerLink) => links.some((other) => sameLink(other, link));

	const dotTone = (id: VectorId, layer: number): DotTone => {
		if (layer === 0 && id === step.answer) return 'add';
		if (layer === 0 && id === step.trueNearest) return 'remove';
		if (step.candidates?.layer === layer && step.candidates.ids.includes(id)) return 'focus';
		if (step.examined?.layer === layer && step.examined.to.includes(id)) return 'focus';
		return 'plain';
	};

	const linkTone = (link: LayerLink): LinkTone => {
		if (has(step.flashedLinks, link)) return 'remove';
		if (has(step.path, link) || has(step.addedLinks, link)) return 'add';
		const examined = step.examined;
		if (examined?.layer === link.layer && examined.to.some((to) => sameLink({ layer: examined.layer, from: examined.from, to }, link))) return 'focus';
		return 'plain';
	};

	const layers = Array.from({ length: TOP_LAYER + 1 }, (_, index) => TOP_LAYER - index);

	return (
		<PlotCanvas width={CANVAS_WIDTH} height={CANVAS_HEIGHT}>
			{layers.map((layer) => {
				const links = [...graph.linksOn(layer), ...step.addedLinks.filter((link) => link.layer === layer)];
				return [
					<Plane
						key={`plane-${layer}`}
						left={planeLeft(layer)}
						top={PLANE_TOP}
						width={PLANE_WIDTH}
						height={PLANE_HEIGHT}
						label={`layer ${layer}${layer === 0 ? ' · every vector' : ''}`}
						active={layer === step.ringLayer}
					/>,
					...links.map((link) => (
						<Link
							key={linkKey(link)}
							from={positionOf(link.from, layer)}
							to={positionOf(link.to, layer)}
							tone={linkTone(link)}
							hidden={has(step.prunedLinks, link) && !has(step.flashedLinks, link)}
						/>
					)),
					...graph.allVectors().map((vector) => {
						const onLayer = graph.isOn(vector.id, layer);
						return (
							<Dot
								key={`dot-${layer}-${vector.id}`}
								position={toPlane(layer, vector)}
								tone={onLayer ? dotTone(vector.id, layer) : 'plain'}
								ghost={!onLayer}
								label={onLayer ? vector.id : undefined}
							/>
						);
					}),
					showsNewVector && (
						<Dot key={`dot-${layer}-${NEW_VECTOR_ID}`} position={toPlane(layer, target)} tone="add" hidden={!step.linkedLayers.includes(layer)} />
					),
					<QueryMark key={`query-${layer}`} position={toPlane(layer, target)} label={targetLabel} />,
				];
			})}
			<Ring position={positionOf(step.ringAt, step.ringLayer)} />
		</PlotCanvas>
	);
}
