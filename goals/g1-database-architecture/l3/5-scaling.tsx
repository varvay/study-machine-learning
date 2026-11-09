import { Canvas, Cell, Dot, Link, Plane, PlotCanvas, RowLabel, type CellTone, type LinkTone, type PlotPosition } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

type HashPosition = number;
type NodeName = string;

interface RingInput {
	nodes: HashPosition[];
	joinAt: HashPosition;
	keys: HashPosition[];
}

interface RingNode {
	name: NodeName;
	position: HashPosition;
}

type Phase = 'intro' | 'assign' | 'join' | 'move' | 'summary';

interface RingStep extends Step {
	phase: Phase;
}

type RingSceneProps = SceneProps<RingInput, RingStep>;

const RING_SIZE = 100;
const MIN_NODES = 2;
const MAX_NODES = 5;
const MIN_KEYS = 3;
const MAX_KEYS = 10;
const MIN_GAP = 3;
const NODE_NAMES = 'ABCDEF';

const PLOT_WIDTH = 600;
const PLANE_TOP = 24;
const PLANE_HEIGHT = 400;
const CENTER: PlotPosition = { x: 300, y: PLANE_TOP + PLANE_HEIGHT / 2 };
const NODE_RADIUS = 165;
const KEY_RADIUS = 118;
const RING_SEGMENTS = 100;

const GRID_ROW_PITCH = 62;
const GRID_FIRST_TOP = 26;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const oldNodesOf = ({ nodes }: RingInput): RingNode[] => nodes.map((position, index) => ({ name: NODE_NAMES[index], position }));
const joiningNodeOf = ({ nodes, joinAt }: RingInput): RingNode => ({ name: NODE_NAMES[nodes.length], position: joinAt });
const allNodesOf = (input: RingInput) => [...oldNodesOf(input), joiningNodeOf(input)];
const sortedKeysOf = ({ keys }: RingInput) => [...keys].sort((a, b) => a - b);

function ringOwner(nodes: RingNode[], key: HashPosition): RingNode {
	const clockwise = [...nodes].sort((a, b) => a.position - b.position);
	return clockwise.find((node) => node.position >= key) ?? clockwise[0];
}

const moduloOwner = (nodes: RingNode[], key: HashPosition) => nodes[key % nodes.length];

function placementsOf(input: RingInput) {
	const before = oldNodesOf(input);
	const after = allNodesOf(input);
	return sortedKeysOf(input).map((key) => {
		const ringBefore = ringOwner(before, key);
		const ringAfter = ringOwner(after, key);
		const moduloBefore = moduloOwner(before, key);
		const moduloAfter = moduloOwner(after, key);
		return { key, ringBefore, ringAfter, moduloBefore, moduloAfter, ringMoved: ringBefore.name !== ringAfter.name, moduloMoved: moduloBefore.name !== moduloAfter.name };
	});
}

function predecessorOf(input: RingInput) {
	const clockwise = oldNodesOf(input).sort((a, b) => a.position - b.position);
	const before = clockwise.filter((node) => node.position < input.joinAt);
	return before.at(-1) ?? clockwise.at(-1)!;
}

const successorOf = (input: RingInput) => ringOwner(oldNodesOf(input), input.joinAt);

function inTakenArc(input: RingInput, position: HashPosition) {
	const from = predecessorOf(input).position;
	const to = input.joinAt;
	return from < to ? position > from && position <= to : position > from || position <= to;
}

function countsByNode(nodes: RingNode[], owners: RingNode[]) {
	return nodes.map((node) => `${node.name} ${owners.filter((owner) => owner.name === node.name).length}`).join(', ');
}

function introNarration(input: RingInput) {
	const nodes = oldNodesOf(input);
	return `The ring is the hash space 0–${RING_SIZE - 1}, read clockwise, wrapping from ${RING_SIZE - 1} back to 0. Each node sits at the hash of its name (${nodes.map((node) => `${node.name} at ${node.position}`).join(', ')}); each key sits at the hash of the key. Numbers on the inner circle are key hashes.`;
}

function assignNarration(input: RingInput) {
	const nodes = oldNodesOf(input);
	const placements = placementsOf(input);
	const ringCounts = countsByNode(nodes, placements.map((placement) => placement.ringBefore));
	return `Rule: a key belongs to the first node at or after it, clockwise. So each node owns the arc from the previous node up to itself. Keys per node: ${ringCounts}. The grid's "mod ${nodes.length}" row shows the other common scheme, node = hash mod ${nodes.length}, for comparison.`;
}

function joinNarration(input: RingInput) {
	const joining = joiningNodeOf(input);
	const predecessor = predecessorOf(input);
	const successor = successorOf(input);
	return `Node ${joining.name} joins at ${joining.position}. Only one arc changes owner: the stretch after ${predecessor.name} (${predecessor.position}) up to ${joining.name} (${joining.position}), shown green, which ${successor.name} used to own. Every key outside it keeps its node.`;
}

function moveNarration(input: RingInput) {
	const placements = placementsOf(input);
	const joining = joiningNodeOf(input);
	const successor = successorOf(input);
	const ringMoved = placements.filter((placement) => placement.ringMoved);
	const moduloMoved = placements.filter((placement) => placement.moduloMoved).length;
	const ringPart =
		ringMoved.length === 0
			? `No key hashes into that arc, so no key moves, and ${joining.name} starts empty.`
			: `${plural(ringMoved.length, 'key')} (${ringMoved.map((placement) => placement.key).join(', ')}) ${ringMoved.length === 1 ? 'moves' : 'move'}, all from ${successor.name} to ${joining.name}.`;
	const oldCount = input.nodes.length;
	return `${ringPart} Under hash mod N, going from ${oldCount} to ${oldCount + 1} nodes changes the divisor, so ${moduloMoved} of ${input.keys.length} keys move, many between nodes that did not change at all.`;
}

function summaryNarration(input: RingInput) {
	const placements = placementsOf(input);
	const oldCount = input.nodes.length;
	const newCount = oldCount + 1;
	const ringMoved = placements.filter((placement) => placement.ringMoved).length;
	const moduloMoved = placements.filter((placement) => placement.moduloMoved).length;
	const counts = countsByNode(allNodesOf(input), placements.map((placement) => placement.ringAfter));
	return `Moved: ${ringMoved} of ${input.keys.length} on the ring, ${moduloMoved} of ${input.keys.length} with mod N. On average a join moves about 1/${newCount} of the keys on a ring, but ${oldCount}/${newCount} with mod N. Keys per node now: ${counts}. One position per node gives arcs of chance sizes, hence uneven load; real systems give each node many positions (virtual nodes) to even it out.`;
}

function buildSteps(input: RingInput): RingStep[] {
	const placements = placementsOf(input);
	const readout = (phase: Phase) => {
		const joined = phase === 'move' || phase === 'summary';
		return {
			nodes: joined ? input.nodes.length + 1 : input.nodes.length,
			keys: input.keys.length,
			'moved (ring)': joined ? placements.filter((placement) => placement.ringMoved).length : '–',
			'moved (mod N)': joined ? placements.filter((placement) => placement.moduloMoved).length : '–',
		};
	};
	const narrations: Record<Phase, string> = {
		intro: introNarration(input),
		assign: assignNarration(input),
		join: joinNarration(input),
		move: moveNarration(input),
		summary: summaryNarration(input),
	};
	return (Object.keys(narrations) as Phase[]).map((phase) => ({ phase, narration: narrations[phase], readout: readout(phase) }));
}

function onCircle(position: HashPosition, radius: number): PlotPosition {
	const angle = (2 * Math.PI * position) / RING_SIZE - Math.PI / 2;
	return { x: CENTER.x + radius * Math.cos(angle), y: CENTER.y + radius * Math.sin(angle) };
}

const hasJoined = (phase: Phase) => phase === 'move' || phase === 'summary';

function RingScene({ input, step: { phase } }: RingSceneProps) {
	const joining = joiningNodeOf(input);
	const showJoining = phase !== 'intro' && phase !== 'assign';
	const segmentTone = (index: number): LinkTone => (showJoining && inTakenArc(input, index + 1) ? 'add' : 'plain');
	const placements = placementsOf(input);

	return (
		<PlotCanvas width={PLOT_WIDTH} height={PLANE_TOP + PLANE_HEIGHT + 4}>
			<Plane left={0} top={PLANE_TOP} width={PLOT_WIDTH} height={PLANE_HEIGHT} label={`hash ring 0–${RING_SIZE - 1}, clockwise from the top`} />
			{Array.from({ length: RING_SEGMENTS }, (_, index) => (
				<Link
					key={`ring-${index}`}
					from={onCircle((index * RING_SIZE) / RING_SEGMENTS, NODE_RADIUS)}
					to={onCircle(((index + 1) * RING_SIZE) / RING_SEGMENTS, NODE_RADIUS)}
					tone={segmentTone(index)}
				/>
			))}
			{placements.map((placement) => {
				const owner = hasJoined(phase) ? placement.ringAfter : placement.ringBefore;
				const moved = hasJoined(phase) && placement.ringMoved;
				return [
					<Link
						key={`owner-${placement.key}`}
						from={onCircle(placement.key, KEY_RADIUS)}
						to={onCircle(owner.position, NODE_RADIUS)}
						tone={moved ? 'remove' : 'plain'}
						hidden={phase === 'intro'}
					/>,
					<Dot key={`key-${placement.key}`} position={onCircle(placement.key, KEY_RADIUS)} tone={moved ? 'remove' : 'plain'} label={String(placement.key)} />,
				];
			})}
			{oldNodesOf(input).map((node) => (
				<Dot key={`node-${node.name}`} position={onCircle(node.position, NODE_RADIUS)} tone="focus" label={`${node.name} ${node.position}`} />
			))}
			<Dot key={`node-${joining.name}`} position={onCircle(joining.position, NODE_RADIUS)} tone="add" label={`${joining.name} ${joining.position}`} hidden={!showJoining} />
		</PlotCanvas>
	);
}

function PlacementGrid({ input, step: { phase } }: RingSceneProps) {
	const placements = placementsOf(input);
	const oldCount = input.nodes.length;
	const rowTop = (row: number) => GRID_FIRST_TOP + row * GRID_ROW_PITCH;
	const assigned = phase !== 'intro';
	const joined = hasJoined(phase);
	const movedTone = (moved: boolean): CellTone => (moved ? 'remove' : 'plain');

	return (
		<Canvas columns={placements.length} height={rowTop(5)}>
			<RowLabel top={rowTop(0) + 16}>key hash</RowLabel>
			<RowLabel top={rowTop(1) + 16} hidden={!assigned}>ring, {oldCount}</RowLabel>
			<RowLabel top={rowTop(2) + 16} hidden={!joined}>ring, {oldCount + 1}</RowLabel>
			<RowLabel top={rowTop(3) + 16} hidden={!assigned}>mod {oldCount}</RowLabel>
			<RowLabel top={rowTop(4) + 16} hidden={!joined}>mod {oldCount + 1}</RowLabel>
			{placements.map((placement, column) => [
				<Cell key={`hash-${placement.key}`} value={placement.key} column={column} top={rowTop(0)} />,
				<Cell key={`ring-before-${placement.key}`} value={placement.ringBefore.name} column={column} top={rowTop(1)} hidden={!assigned} />,
				<Cell key={`ring-after-${placement.key}`} value={placement.ringAfter.name} column={column} top={rowTop(2)} tone={movedTone(placement.ringMoved)} hidden={!joined} />,
				<Cell key={`mod-before-${placement.key}`} value={placement.moduloBefore.name} column={column} top={rowTop(3)} hidden={!assigned} />,
				<Cell key={`mod-after-${placement.key}`} value={placement.moduloAfter.name} column={column} top={rowTop(4)} tone={movedTone(placement.moduloMoved)} hidden={!joined} />,
			])}
		</Canvas>
	);
}

function parsePositions(raw: string, label: string, min: number, max: number): HashPosition[] | string {
	const positions = raw
		.split(/[\s,]+/)
		.filter(Boolean)
		.map(Number);
	if (positions.length < min || positions.length > max) return `Enter ${min} to ${max} ${label} positions.`;
	if (positions.some((position) => !Number.isInteger(position) || position < 0 || position >= RING_SIZE)) return `Positions are whole numbers from 0 to ${RING_SIZE - 1}.`;
	return positions;
}

function circularGap(a: HashPosition, b: HashPosition) {
	const distance = Math.abs(a - b);
	return Math.min(distance, RING_SIZE - distance);
}

const tooClose = (positions: HashPosition[]) => positions.some((a, index) => positions.slice(index + 1).some((b) => circularGap(a, b) < MIN_GAP));

export default defineExplainer<RingInput, RingStep>({
	title: 'Consistent hashing: a node joins',
	stages: [
		{
			title: 'The hash ring',
			subtitle: 'Outer circle: nodes, placed by the hash of their name. Inner circle: keys, placed by their hash; each line joins a key to the node that stores it. Red: a key that had to move to another node.',
			Scene: RingScene,
		},
		{
			title: 'Where each key lives',
			subtitle: 'The same keys under the ring rule and under node = hash mod N, before and after the join. Red: the key moved, so its data is copied across the network.',
			Scene: PlacementGrid,
		},
	],
	examples: [
		{ input: { nodes: [10, 45, 80], joinAt: 60, keys: [5, 18, 30, 41, 52, 57, 66, 73, 88, 95] }, note: 'A fourth node joins' },
		{ input: { nodes: [20, 50], joinAt: 90, keys: [8, 15, 33, 47, 62, 71, 84, 97] }, note: 'Two nodes become three' },
		{ input: { nodes: [10, 40, 70], joinAt: 14, keys: [5, 22, 31, 48, 55, 63, 77, 92] }, note: 'A join into a small gap' },
	],
	fields: [
		{ name: 'nodes', label: 'node positions', placeholder: 'e.g. 10 45 80' },
		{ name: 'join', label: 'new node at', placeholder: 'e.g. 60' },
		{ name: 'keys', label: 'key hashes', placeholder: 'e.g. 5 18 30 52 66' },
	],
	describe: ({ nodes, joinAt, keys }) => `nodes ${nodes.join(' ')} + ${joinAt} · ${plural(keys.length, 'key')}`,
	parse(values) {
		const nodes = parsePositions(values.nodes, 'node', MIN_NODES, MAX_NODES);
		if (typeof nodes === 'string') return { error: nodes };
		const joinAt = Number(values.join);
		if (values.join === '' || !Number.isInteger(joinAt) || joinAt < 0 || joinAt >= RING_SIZE) return { error: `The new node's position is a whole number from 0 to ${RING_SIZE - 1}.` };
		if (tooClose([...nodes, joinAt])) return { error: `Keep nodes, the new one included, at least ${MIN_GAP} apart on the ring so their labels stay readable.` };
		const keys = parsePositions(values.keys, 'key', MIN_KEYS, MAX_KEYS);
		if (typeof keys === 'string') return { error: keys };
		if (tooClose(keys)) return { error: `Keep keys at least ${MIN_GAP} apart on the ring so their labels stay readable.` };
		return { input: { nodes, joinAt, keys } };
	},
	steps: buildSteps,
});
