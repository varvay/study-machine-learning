import { defineExplainer, type SceneProps } from '../../../src/explainer/types';
import {
	BASE_VECTORS,
	TOP_LAYER,
	LayersView,
	baseGraph,
	distance,
	emptyState,
	rounded,
	walkNarration,
	type Coordinates,
	type HnswStep,
	type LayerLink,
	type VectorId,
	type WalkNarrationContext,
} from '../hnsw';

interface SearchInput {
	query: Coordinates;
}

function resultNarration(target: Coordinates, answer: VectorId, trueNearest: VectorId, computedCount: number) {
	const found = ` ${answer} is the answer, after ${computedCount} distance computations out of ${BASE_VECTORS.length} vectors.`;
	if (answer === trueNearest) return `${found} It is also the true nearest.`;
	return `${found} The true nearest is ${trueNearest} (${rounded(distance(target, baseGraph.vector(trueNearest)))}): the walk missed it. That is the "approximate" in ANN. Real searches keep a list of several candidates (ef_search) to miss less.`;
}

function searchSteps({ query }: SearchInput): HnswStep[] {
	const { trace, answer } = baseGraph.search(query);
	const trueNearest = baseGraph.allVectors().sort((a, b) => distance(query, a) - distance(query, b))[0].id;
	const context: WalkNarrationContext = { graph: baseGraph, target: query, purpose: 'search' };
	const computed = new Set([baseGraph.entry]);
	let path: LayerLink[] = [];
	const readout = (layer: number) => ({ layer, 'distances computed': `${computed.size} of ${BASE_VECTORS.length}` });

	const steps: HnswStep[] = [
		{
			...emptyState(),
			ringLayer: TOP_LAYER,
			ringAt: baseGraph.entry,
			readout: readout(TOP_LAYER),
			narration: `Find the vector nearest the query ◆. The index cannot jump to the query's location: knowing which vector sits there is the answer being searched for. So every search starts at the same entry point, ${baseGraph.entry}, on the sparse top layer, and compares distances as it follows links. This walk keeps one candidate at a time.`,
		},
	];

	for (const event of trace) {
		event.examined.forEach((id) => computed.add(id));
		if (event.kind === 'hop') path = [...path, { layer: event.layer, from: event.from, to: event.to }];
		const isLast = event.kind === 'stay' && event.layer === 0;
		const ringLayer = event.kind === 'stay' ? Math.max(0, event.layer - 1) : event.layer;
		steps.push({
			...emptyState(),
			path,
			ringLayer,
			ringAt: event.kind === 'hop' ? event.to : event.at,
			examined: { layer: event.layer, from: event.kind === 'hop' ? event.from : event.at, to: event.examined },
			readout: readout(ringLayer),
			narration: walkNarration(context, event) + (isLast ? resultNarration(query, answer, trueNearest, computed.size) : ''),
			...(isLast && { answer, trueNearest }),
		});
	}
	return steps;
}

function SearchScene({ input, step }: SceneProps<SearchInput, HnswStep>) {
	return <LayersView target={input.query} targetLabel="query" showsNewVector={false} step={step} />;
}

const isCoordinate = (value: number) => Number.isInteger(value) && value >= 0 && value <= 100;

export default defineExplainer<SearchInput, HnswStep>({
	title: 'HNSW: from the top layer down to layer 0',
	stages: [
		{
			title: 'Three layers of one graph',
			subtitle: 'Left to right: the top layer down to layer 0. Each layer holds some of the vectors of the layer below it; layer 0 holds them all. Faint dots live only lower down.',
			Scene: SearchScene,
		},
	],
	examples: [
		{ input: { query: { x: 85, y: 85 } }, note: 'Far corner' },
		{ input: { query: { x: 40, y: 45 } }, note: 'A miss' },
		{ input: { query: { x: 15, y: 90 } }, note: 'Bottom left' },
	],
	fields: [
		{ name: 'x', label: 'query x', placeholder: '0–100' },
		{ name: 'y', label: 'query y', placeholder: '0–100' },
	],
	describe: ({ query }) => `query (${query.x}, ${query.y})`,
	parse(values) {
		const query = { x: Number(values.x), y: Number(values.y) };
		if (values.x === '' || values.y === '' || !isCoordinate(query.x) || !isCoordinate(query.y)) return { error: 'Use whole numbers from 0 to 100 for x and y.' };
		return { input: { query } };
	},
	steps: searchSteps,
});
