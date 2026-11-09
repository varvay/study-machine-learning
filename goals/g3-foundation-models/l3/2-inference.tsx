import { Canvas, Cell, Chips, ColumnMarker, RowLabel, type CellTone, type Chip } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

interface BatchingInput {
	outputLengths: number[];
	slots: number;
}

interface BatchingStep extends Step {
	iteration: number;
}

type BatchingSceneProps = SceneProps<BatchingInput, BatchingStep>;

type Scheduler = 'static' | 'continuous';

interface TokenWork {
	request: number;
	tokenNumber: number;
	length: number;
}

type SlotWork = TokenWork | undefined;

interface Timeline {
	grid: SlotWork[][];
	finishIteration: number[];
	startIteration: number[];
	makespan: number;
}

const MIN_REQUESTS = 2;
const MAX_REQUESTS = 6;
const MAX_LENGTH = 6;
const MAX_SLOTS = 3;
const MAX_ITERATIONS = 12;

const SLOT_TOP = 58;
const SLOT_PITCH = 66;

const requestName = (request: number) => String.fromCharCode(65 + request);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function listNames(requests: number[]) {
	const names = [...requests].sort((a, b) => a - b).map(requestName);
	return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

const generateClause = (requests: number[]) => (requests.length === 1 ? `${listNames(requests)} generates one token.` : `${listNames(requests)} each generate one token.`);
const finishClause = (requests: number[], leaves: string) => (requests.length === 1 ? ` ${listNames(requests)} finishes${leaves}.` : ` ${listNames(requests)} finish${leaves}.`);

function emptyGrid(slots: number, iterations: number): SlotWork[][] {
	return Array.from({ length: slots }, () => Array.from({ length: iterations }, (): SlotWork => undefined));
}

function staticTimeline({ outputLengths, slots }: BatchingInput): Timeline {
	const batches: number[][] = [];
	for (let first = 0; first < outputLengths.length; first += slots) batches.push(outputLengths.map((_, request) => request).slice(first, first + slots));
	const makespan = batches.reduce((total, batch) => total + Math.max(...batch.map((request) => outputLengths[request])), 0);
	const grid = emptyGrid(slots, makespan);
	const finishIteration: number[] = [];
	const startIteration: number[] = [];
	let batchStart = 0;
	for (const batch of batches) {
		batch.forEach((request, slot) => {
			const length = outputLengths[request];
			startIteration[request] = batchStart + 1;
			finishIteration[request] = batchStart + length;
			for (let token = 1; token <= length; token++) grid[slot][batchStart + token - 1] = { request, tokenNumber: token, length };
		});
		batchStart += Math.max(...batch.map((request) => outputLengths[request]));
	}
	return { grid, finishIteration, startIteration, makespan };
}

function continuousTimeline({ outputLengths, slots }: BatchingInput): Timeline {
	const slotFreeFrom = Array.from({ length: slots }, () => 1);
	const finishIteration: number[] = [];
	const startIteration: number[] = [];
	const slotOf: number[] = [];
	outputLengths.forEach((length, request) => {
		const earliest = Math.min(...slotFreeFrom);
		slotOf[request] = slotFreeFrom.indexOf(earliest);
		startIteration[request] = earliest;
		finishIteration[request] = earliest + length - 1;
		slotFreeFrom[slotOf[request]] = finishIteration[request] + 1;
	});
	const makespan = Math.max(...finishIteration);
	const grid = emptyGrid(slots, makespan);
	outputLengths.forEach((length, request) => {
		for (let token = 1; token <= length; token++) grid[slotOf[request]][startIteration[request] + token - 2] = { request, tokenNumber: token, length };
	});
	return { grid, finishIteration, startIteration, makespan };
}

const timelineOf = (scheduler: Scheduler, input: BatchingInput) => (scheduler === 'static' ? staticTimeline(input) : continuousTimeline(input));

function idleSlotSteps(timeline: Timeline, upToIteration: number) {
	const last = Math.min(upToIteration, timeline.makespan);
	return timeline.grid.reduce((idle, row) => idle + row.slice(0, last).filter((work) => work === undefined).length, 0);
}

const finishedBy = (timeline: Timeline, iteration: number) => timeline.finishIteration.filter((finish) => finish <= iteration).length;

const averageFinish = (timeline: Timeline) => timeline.finishIteration.reduce((sum, finish) => sum + finish, 0) / timeline.finishIteration.length;

function iterationDetails(timeline: Timeline, iteration: number) {
	const column = timeline.grid.map((row) => row[iteration - 1]);
	const running = column.filter((work): work is TokenWork => work !== undefined).map((work) => work.request);
	const idleSlots = column.filter((work) => work === undefined).length;
	const joined = running.filter((request) => timeline.startIteration[request] === iteration);
	const finished = running.filter((request) => timeline.finishIteration[request] === iteration);
	const queued = timeline.startIteration.filter((start) => start > iteration).length;
	return { running, idleSlots, joined, finished, queued };
}

function staticSentence(timeline: Timeline, iteration: number, slots: number) {
	if (iteration > timeline.makespan) return '';
	const { running, idleSlots, joined, finished, queued } = iterationDetails(timeline, iteration);
	const batchStart = joined.length > 0 ? `a new batch (${listNames(joined)}) starts; ` : '';
	const idleCount = idleSlots === 1 ? `1 of ${slots} slots sits` : `${idleSlots} of ${slots} slots sit`;
	const idle =
		idleSlots === 0
			? ''
			: queued > 0
				? ` ${idleCount} idle while ${plural(queued, 'request')} wait${queued === 1 ? 's' : ''}: a finished request keeps its place until the whole batch ends.`
				: ` ${idleCount} idle.`;
	const done = finished.length > 0 ? finishClause(finished, '') : '';
	return `<b>Static:</b> ${batchStart}${generateClause(running)}${done}${idle}`;
}

function continuousSentence(timeline: Timeline, iteration: number) {
	if (iteration > timeline.makespan) return `<b>Continuous:</b> all requests finished at iteration ${timeline.makespan}.`;
	const { running, idleSlots, joined, finished, queued } = iterationDetails(timeline, iteration);
	const joinVerb = joined.length === 1 ? 'takes the slot' : 'take the slots';
	const join = joined.length > 0 && iteration > 1 ? `${listNames(joined)} ${joinVerb} freed after the previous iteration; ` : '';
	const done = finished.length > 0 ? finishClause(finished, ' and leave' + (finished.length === 1 ? 's' : '')) : '';
	const idle = idleSlots > 0 ? ` ${idleSlots === 1 ? '1 slot sits' : `${idleSlots} slots sit`} idle: ${queued > 0 ? 'waiting for work' : 'the queue is empty'}.` : '';
	return `<b>Continuous:</b> ${join}${generateClause(running)}${done}${idle}`;
}

function readoutAt(input: BatchingInput, iteration: number) {
	const fixed = staticTimeline(input);
	const rolling = continuousTimeline(input);
	return {
		iteration,
		'finished (static)': `${finishedBy(fixed, iteration)}/${input.outputLengths.length}`,
		'finished (continuous)': `${finishedBy(rolling, iteration)}/${input.outputLengths.length}`,
		'idle slot-steps': `${idleSlotSteps(fixed, iteration)} vs ${idleSlotSteps(rolling, iteration)}`,
	};
}

function summaryNarration(input: BatchingInput) {
	const fixed = staticTimeline(input);
	const rolling = continuousTimeline(input);
	const tokens = input.outputLengths.reduce((sum, length) => sum + length, 0);
	const speedup = fixed.makespan / rolling.makespan;
	const closing =
		fixed.makespan === rolling.makespan && idleSlotSteps(fixed, fixed.makespan) === 0
			? 'Here every request in a batch finishes together, so no slot is ever freed early and the two schedulers match. Real chat traffic has widely varying output lengths, which is where continuous batching wins.'
			: 'The gap widens as output lengths vary more, which is the normal case for chat.';
	return `Both schedulers generated the same ${tokens} tokens. Static batching needed ${fixed.makespan} iterations and wasted ${plural(idleSlotSteps(fixed, fixed.makespan), 'slot-step')}; continuous batching needed ${rolling.makespan} and wasted ${idleSlotSteps(rolling, rolling.makespan)}, which is ${speedup.toFixed(2)}× the throughput. A request finished on average at iteration ${averageFinish(fixed).toFixed(1)} under static batching and ${averageFinish(rolling).toFixed(1)} under continuous batching. ${closing}`;
}

function buildSteps(input: BatchingInput): BatchingStep[] {
	const fixed = staticTimeline(input);
	const rolling = continuousTimeline(input);
	const requests = input.outputLengths.map((length, request) => `${requestName(request)} needs ${length}`).join(', ');
	const steps: BatchingStep[] = [
		{
			iteration: 0,
			readout: readoutAt(input, 0),
			narration: `${plural(input.outputLengths.length, 'request')} wait in the queue: ${requests} output tokens. The GPU runs ${plural(input.slots, 'slot')}, the most sequences one batch holds. One <b>iteration</b> is one forward pass that generates one token for every sequence in the batch. A request's first iteration also runs its prefill. Both schedulers run the same requests.`,
		},
	];
	for (let iteration = 1; iteration <= fixed.makespan; iteration++) {
		steps.push({
			iteration,
			readout: readoutAt(input, iteration),
			narration: `Iteration ${iteration}. ${staticSentence(fixed, iteration, input.slots)} ${continuousSentence(rolling, iteration)}`,
		});
	}
	steps.push({ iteration: fixed.makespan, readout: readoutAt(input, fixed.makespan), narration: summaryNarration(input) });
	return steps;
}

function workTone(work: TokenWork): CellTone {
	if (work.tokenNumber === work.length) return 'add';
	if (work.tokenNumber === 1) return 'focus';
	return 'plain';
}

function schedulerScene(scheduler: Scheduler) {
	return function SchedulerScene({ input, step: { iteration } }: BatchingSceneProps) {
		const timeline = timelineOf(scheduler, input);
		const columns = staticTimeline(input).makespan;
		const height = SLOT_TOP + input.slots * SLOT_PITCH;
		const markerColumn = Math.min(iteration, timeline.makespan) - 1;
		return (
			<Canvas columns={columns} height={height}>
				{timeline.grid.map((_, slot) => (
					<RowLabel key={`slot-label-${slot}`} top={SLOT_TOP + slot * SLOT_PITCH + 16}>
						slot {slot + 1}
					</RowLabel>
				))}
				{timeline.grid.flatMap((row, slot) =>
					row.map((work, column) => (
						<Cell
							key={`cell-${slot}-${column}`}
							value={work ? `${requestName(work.request)}${work.tokenNumber}` : 'idle'}
							column={column}
							top={SLOT_TOP + slot * SLOT_PITCH}
							tone={work ? workTone(work) : 'remove'}
							hidden={column >= iteration}
						/>
					)),
				)}
				<ColumnMarker column={Math.max(markerColumn, 0)} top={SLOT_TOP - 26} height={input.slots * SLOT_PITCH + 14} label={`iteration ${Math.max(markerColumn + 1, 1)}`} hidden={markerColumn < 0} />
			</Canvas>
		);
	};
}

function schedulerQueue(scheduler: Scheduler) {
	return function SchedulerQueue({ input, step: { iteration } }: BatchingSceneProps) {
		const timeline = timelineOf(scheduler, input);
		const chips: Chip[] = input.outputLengths.map((length, request) => {
			const name = `${requestName(request)} · ${length} tokens`;
			if (timeline.finishIteration[request] <= iteration) return { label: `${name} · done`, state: 'plain' };
			if (timeline.startIteration[request] <= iteration) return { label: `${name} · running`, state: 'current' };
			return { label: `${name} · queued`, state: 'upcoming' };
		});
		return <Chips chips={chips} />;
	};
}

export default defineExplainer<BatchingInput, BatchingStep>({
	title: 'Static batching against continuous batching',
	stages: [
		{
			title: 'Static batching: the batch is fixed until its longest request ends',
			subtitle: 'Each cell is one token: A3 is request A’s third. Blue: first token (with prefill). Green: last token. Red: an idle slot.',
			Scene: schedulerScene('static'),
			Footer: schedulerQueue('static'),
		},
		{
			title: 'Continuous batching: the batch is rebuilt every iteration',
			subtitle: 'The same requests and slots. A finished request leaves at once, and the next queued request takes its slot.',
			Scene: schedulerScene('continuous'),
			Footer: schedulerQueue('continuous'),
		},
	],
	examples: [
		{ input: { outputLengths: [5, 1, 2, 2], slots: 2 }, note: 'One long answer' },
		{ input: { outputLengths: [4, 1, 3, 1, 2, 2], slots: 3 }, note: 'Mixed lengths, 3 slots' },
		{ input: { outputLengths: [3, 3, 3, 3], slots: 2 }, note: 'Equal lengths: no gain' },
	],
	fields: [
		{ name: 'lengths', label: 'output tokens per request', placeholder: 'e.g. 5 1 2 2' },
		{ name: 'slots', label: 'batch slots', placeholder: '2' },
	],
	describe: ({ outputLengths, slots }) => `${outputLengths.map((length, request) => `${requestName(request)}${length}`).join(' ')} · ${slots} slots`,
	parse(values) {
		const outputLengths = values.lengths.split(/[\s,]+/).filter(Boolean).map(Number);
		if (outputLengths.length < MIN_REQUESTS || outputLengths.length > MAX_REQUESTS) return { error: `Enter ${MIN_REQUESTS} to ${MAX_REQUESTS} requests, one output length each.` };
		if (outputLengths.some((length) => !Number.isInteger(length) || length < 1 || length > MAX_LENGTH)) return { error: `Each output length is a whole number from 1 to ${MAX_LENGTH}.` };
		const slots = values.slots === '' ? 2 : Number(values.slots);
		if (!Number.isInteger(slots) || slots < 1 || slots > MAX_SLOTS) return { error: `Batch slots is a whole number from 1 to ${MAX_SLOTS}; leave it blank for 2.` };
		const input = { outputLengths, slots };
		if (staticTimeline(input).makespan > MAX_ITERATIONS) return { error: `Static batching would need more than ${MAX_ITERATIONS} iterations to show; use shorter outputs or more slots.` };
		return { input };
	},
	steps: buildSteps,
});
