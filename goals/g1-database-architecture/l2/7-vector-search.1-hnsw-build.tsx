import { defineExplainer, type SceneProps } from '../../../src/explainer/types';
import {
	EF_CONSTRUCTION,
	LINKS_PER_INSERT,
	NEW_VECTOR_ID,
	TOP_LAYER,
	LayersView,
	baseGraph,
	describeDistances,
	emptyState,
	joinNames,
	maxLinksOn,
	sameLink,
	walkNarration,
	type Coordinates,
	type HnswStep,
	type LayerLink,
	type WalkNarrationContext,
} from '../hnsw';

interface InsertInput {
	point: Coordinates;
	topLayer: number;
}

function insertSteps(input: InsertInput): HnswStep[] {
	const graph = baseGraph.clone();
	const target = input.point;
	const trace = graph.insert({ id: NEW_VECTOR_ID, ...target, topLayer: input.topLayer });
	const context: WalkNarrationContext = { graph, target, purpose: 'insert' };
	const state = emptyState();
	let ringAt = graph.entry;
	let ringLayer = TOP_LAYER;
	const newLinks = () => state.addedLinks.filter((added) => !state.prunedLinks.some((pruned) => sameLink(added, pruned))).length;
	const readout = (layer: number) => ({ layer, 'new links': newLinks() });
	const layersBelow = input.topLayer === 0 ? 'layer 0 only' : `layers ${input.topLayer} to 0`;

	const steps: HnswStep[] = [
		{
			...emptyState(),
			ringLayer,
			ringAt,
			readout: readout(TOP_LAYER),
			narration: `Insert a new vector ◆. It draws its top layer at random, and most vectors get layer 0. This one got layer ${input.topLayer}, so it will live on ${layersBelow}. Its links are chosen now, once.`,
		},
	];

	for (const event of trace) {
		const base = { ...state, flashedLinks: [] as LayerLink[] };
		if (event.kind === 'hop' || event.kind === 'stay') {
			ringAt = event.kind === 'hop' ? event.to : event.at;
			ringLayer = event.kind === 'stay' ? event.layer - 1 : event.layer;
			steps.push({
				...base,
				ringLayer,
				ringAt,
				examined: { layer: event.layer, from: event.kind === 'hop' ? event.from : event.at, to: event.examined },
				readout: readout(ringLayer),
				narration: walkNarration(context, event),
			});
		} else if (event.kind === 'candidates') {
			ringAt = event.start;
			ringLayer = event.layer;
			steps.push({
				...base,
				ringLayer,
				ringAt,
				candidates: { layer: event.layer, ids: event.candidates },
				readout: readout(event.layer),
				narration: `Layer ${event.layer}: a wider search from ${event.start} keeps the ${EF_CONSTRUCTION} closest vectors it finds (ef_construction = ${EF_CONSTRUCTION}): ${describeDistances(graph, target, event.candidates)}.`,
			});
		} else if (event.kind === 'link') {
			state.addedLinks = [...state.addedLinks, ...event.neighbors.map((to) => ({ layer: event.layer, from: NEW_VECTOR_ID, to }))];
			state.linkedLayers = [...state.linkedLayers, event.layer];
			steps.push({
				...base,
				addedLinks: state.addedLinks,
				linkedLayers: state.linkedLayers,
				ringLayer,
				ringAt,
				readout: readout(event.layer),
				narration: `Keep the ${LINKS_PER_INSERT} closest, ${joinNames(event.neighbors)}, as the new vector's links on layer ${event.layer}. "Near" is a count, not a distance: the ${LINKS_PER_INSERT} closest found, however far they are. Links go both ways.`,
			});
		} else {
			const dropped = event.dropped.map((to) => ({ layer: event.layer, from: event.owner, to }));
			state.prunedLinks = [...state.prunedLinks, ...dropped];
			steps.push({
				...base,
				prunedLinks: state.prunedLinks,
				flashedLinks: dropped,
				ringLayer,
				ringAt,
				readout: readout(event.layer),
				narration: `${event.owner} now has more than ${maxLinksOn(event.layer)} links on layer ${event.layer}, its limit. It keeps its closest and drops the link to ${joinNames(event.dropped)}.`,
			});
		}
	}

	steps.push({
		...state,
		flashedLinks: [],
		ringLayer: 0,
		ringAt: NEW_VECTOR_ID,
		readout: readout(0),
		narration: `The new vector is linked on ${layersBelow}. Those links stay fixed; later searches only walk them.`,
	});
	return steps;
}

function InsertScene({ input, step }: SceneProps<InsertInput, HnswStep>) {
	return <LayersView target={input.point} targetLabel="new" showsNewVector step={step} />;
}

const isCoordinate = (value: number) => Number.isInteger(value) && value >= 0 && value <= 100;

export default defineExplainer<InsertInput, HnswStep>({
	title: 'HNSW: how an insert chooses its links',
	stages: [
		{
			title: 'Three layers of one graph',
			subtitle: 'Left to right: the top layer down to layer 0. The new vector links on every layer its random draw reached.',
			Scene: InsertScene,
		},
	],
	examples: [
		{ input: { point: { x: 45, y: 65 }, topLayer: 1 }, note: 'Lives on layers 1–0' },
		{ input: { point: { x: 70, y: 40 }, topLayer: 0 }, note: 'Lives on layer 0' },
	],
	fields: [
		{ name: 'x', label: 'x', placeholder: '0–100' },
		{ name: 'y', label: 'y', placeholder: '0–100' },
		{ name: 'layer', label: 'top layer', placeholder: `0–${TOP_LAYER}` },
	],
	describe: ({ point, topLayer }) => `insert (${point.x}, ${point.y}), top layer ${topLayer}`,
	parse(values) {
		const point = { x: Number(values.x), y: Number(values.y) };
		if (values.x === '' || values.y === '' || !isCoordinate(point.x) || !isCoordinate(point.y)) return { error: 'Use whole numbers from 0 to 100 for x and y.' };
		const topLayer = Number(values.layer);
		if (values.layer === '' || !Number.isInteger(topLayer) || topLayer < 0 || topLayer > TOP_LAYER) return { error: `Give a top layer from 0 to ${TOP_LAYER}.` };
		return { input: { point, topLayer } };
	},
	steps: insertSteps,
});
