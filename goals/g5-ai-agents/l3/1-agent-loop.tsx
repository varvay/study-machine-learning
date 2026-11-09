import { Canvas, Cell, RowLabel, SubLabel, Tag, type CellTone } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

type Thousands = number;

interface LoopInput {
	calls: number;
	stepTokens: Thousands;
	compactAbove: Thousands;
}

interface LoopStep extends Step {
	revealedCalls: number;
}

type LoopSceneProps = SceneProps<LoopInput, LoopStep>;

interface CallCost {
	fullHistory: Thousands;
	compacted: Thousands;
	compactedBefore?: Thousands;
}

const BASE_TOKENS: Thousands = 4;
const SUMMARY_TOKENS: Thousands = 2;
const MIN_CALLS = 2;
const MAX_CALLS = 10;
const MAX_STEP_TOKENS: Thousands = 50;
const MAX_THRESHOLD: Thousands = 500;

const FULL_TOP = 30;
const COMPACTED_TOP = 140;
const SCENE_HEIGHT = 250;

const tokens = (value: Thousands) => `${value}k`;

function callCosts({ calls, stepTokens, compactAbove }: LoopInput): CallCost[] {
	const costs: CallCost[] = [];
	let compactedContext = BASE_TOKENS;
	for (let call = 1; call <= calls; call++) {
		let compactedBefore: Thousands | undefined;
		if (compactedContext > compactAbove) {
			compactedBefore = compactedContext;
			compactedContext = BASE_TOKENS + SUMMARY_TOKENS;
		}
		costs.push({ fullHistory: BASE_TOKENS + (call - 1) * stepTokens, compacted: compactedContext, compactedBefore });
		compactedContext += stepTokens;
	}
	return costs;
}

interface Totals {
	fullHistory: Thousands;
	compacted: Thousands;
	summaryCalls: number;
}

function totalsUpTo(costs: CallCost[], callCount: number): Totals {
	return costs.slice(0, callCount).reduce<Totals>(
		(sum, cost) => ({
			fullHistory: sum.fullHistory + cost.fullHistory,
			compacted: sum.compacted + cost.compacted + (cost.compactedBefore ?? 0),
			summaryCalls: sum.summaryCalls + (cost.compactedBefore === undefined ? 0 : 1),
		}),
		{ fullHistory: 0, compacted: 0, summaryCalls: 0 },
	);
}

function readoutAt(costs: CallCost[], callCount: number) {
	const totals = totalsUpTo(costs, callCount);
	const current = costs[callCount - 1];
	return {
		call: callCount === 0 ? '–' : callCount,
		'full: this call': current ? tokens(current.fullHistory) : '–',
		'compacted: this call': current ? tokens(current.compacted) : '–',
		'full: total billed': tokens(totals.fullHistory),
		'compacted: total billed': tokens(totals.compacted),
	};
}

function compactionNarration(input: LoopInput, cost: CallCost) {
	if (cost.compactedBefore === undefined) return ` With compaction it reads <b>${tokens(cost.compacted)}</b>.`;
	return ` With compaction, the history had reached ${tokens(cost.compactedBefore)}, above the ${tokens(input.compactAbove)} limit, so a summarizing call first read those ${tokens(cost.compactedBefore)} and replaced the history with a ${tokens(SUMMARY_TOKENS)} summary. This call reads <b>${tokens(cost.compacted)}</b>.`;
}

function callNarration(input: LoopInput, cost: CallCost, call: number) {
	const priorResults = call - 1;
	if (priorResults === 0) return `Call 1: the model reads only the <b>${tokens(BASE_TOKENS)}</b> base, in both rows.`;
	const full = `Call ${call}: with the full history, the model reads <b>${tokens(cost.fullHistory)}</b> tokens: the ${tokens(BASE_TOKENS)} base plus ${priorResults} earlier step${priorResults === 1 ? '' : 's'} of ${tokens(input.stepTokens)}.`;
	const overLimit = cost.fullHistory > input.compactAbove ? ` That is past the ${tokens(input.compactAbove)} limit set to keep the context short, since recall degrades as context grows (context rot).` : '';
	return `${full}${overLimit}${compactionNarration(input, cost)}`;
}

function summaryNarration(input: LoopInput, costs: CallCost[]) {
	const totals = totalsUpTo(costs, costs.length);
	const saving = Math.round((1 - totals.compacted / totals.fullHistory) * 100);
	const summaries = totals.summaryCalls === 0 ? 'The history never crossed the limit, so compaction never ran.' : `Compaction billed ${tokens(totals.compacted)}, including ${totals.summaryCalls} summarizing call${totals.summaryCalls === 1 ? '' : 's'}: ${saving}% less.`;
	const n = input.calls;
	return `Over ${n} calls, the full history billed ${tokens(totals.fullHistory)} input tokens: N·base + step·N(N−1)/2 = ${n}·${BASE_TOKENS} + ${input.stepTokens}·${n}·${n - 1}/2. The second term grows with the square of the number of calls, because every call re-reads every earlier result. ${summaries} The price of compaction is loss: whatever the summary drops, the agent cannot use later.`;
}

function buildSteps(input: LoopInput): LoopStep[] {
	const costs = callCosts(input);
	const intro: LoopStep = {
		revealedCalls: 0,
		readout: readoutAt(costs, 0),
		narration: `An agent runs ${input.calls} loop steps. Each step is one model call, and the model is stateless, so every call re-sends the whole context: a ${tokens(BASE_TOKENS)} base (system prompt, tool definitions, task) plus everything earlier steps added. Each step adds ${tokens(input.stepTokens)} (the tool call and its result). Top row: keep the full history. Bottom row: compact when the history passes ${tokens(input.compactAbove)}.`,
	};
	const perCall = costs.map((cost, index): LoopStep => ({
		revealedCalls: index + 1,
		readout: readoutAt(costs, index + 1),
		narration: callNarration(input, cost, index + 1),
	}));
	const summary: LoopStep = { revealedCalls: costs.length, readout: readoutAt(costs, costs.length), narration: summaryNarration(input, costs) };
	return [intro, ...perCall, summary];
}

function fullTone(input: LoopInput, cost: CallCost, isCurrent: boolean): CellTone {
	if (cost.fullHistory > input.compactAbove) return 'remove';
	return isCurrent ? 'focus' : 'plain';
}

function compactedTone(cost: CallCost, isCurrent: boolean): CellTone {
	if (cost.compactedBefore !== undefined) return 'add';
	return isCurrent ? 'focus' : 'plain';
}

function LoopScene({ input, step: { revealedCalls } }: LoopSceneProps) {
	const costs = callCosts(input);
	return (
		<Canvas columns={input.calls} height={SCENE_HEIGHT}>
			<RowLabel top={FULL_TOP + 16}>full history</RowLabel>
			<RowLabel top={COMPACTED_TOP + 16}>compacted</RowLabel>
			{costs.map((cost, index) => {
				const shown = index < revealedCalls;
				const isCurrent = index === revealedCalls - 1;
				return [
					<Cell key={`full-${index}`} value={tokens(cost.fullHistory)} column={index} top={FULL_TOP} tone={fullTone(input, cost, isCurrent)} hidden={!shown} />,
					<SubLabel key={`full-call-${index}`} column={index} top={FULL_TOP + 58} hidden={!shown}>
						call {index + 1}
					</SubLabel>,
					<Cell key={`compacted-${index}`} value={tokens(cost.compacted)} column={index} top={COMPACTED_TOP} tone={compactedTone(cost, isCurrent)} hidden={!shown} />,
					<Tag key={`compacted-tag-${index}`} column={index} top={COMPACTED_TOP - 22} tone="add" hidden={!shown || cost.compactedBefore === undefined}>
						summary
					</Tag>,
				];
			})}
		</Canvas>
	);
}

function parseWhole(raw: string, label: string, min: number, max: number): number | string {
	const value = Number(raw.trim());
	if (raw.trim() === '' || !Number.isInteger(value) || value < min || value > max) return `${label} is a whole number from ${min} to ${max}.`;
	return value;
}

export default defineExplainer<LoopInput, LoopStep>({
	title: 'Context growth in a long agent loop',
	stages: [
		{
			title: 'Input tokens each call reads, in thousands',
			subtitle: 'Each column is one model call. Red: the context is past the limit. Green with a “summary” tag: compaction just replaced the history with a summary.',
			Scene: LoopScene,
		},
	],
	examples: [
		{ input: { calls: 10, stepTokens: 6, compactAbove: 30 }, note: 'Tool results of 6k each' },
		{ input: { calls: 10, stepTokens: 20, compactAbove: 60 }, note: 'Large results, such as web pages' },
		{ input: { calls: 5, stepTokens: 3, compactAbove: 40 }, note: 'Short loop, no compaction needed' },
	],
	fields: [
		{ name: 'calls', label: 'loop steps', placeholder: `${MIN_CALLS} to ${MAX_CALLS}` },
		{ name: 'step', label: 'tokens per step (k)', placeholder: 'e.g. 6' },
		{ name: 'limit', label: 'compact above (k)', placeholder: 'e.g. 30' },
	],
	describe: ({ calls, stepTokens, compactAbove }) => `${calls} steps · ${tokens(stepTokens)} per step · compact above ${tokens(compactAbove)}`,
	parse(values) {
		const calls = parseWhole(values.calls ?? '', 'Loop steps', MIN_CALLS, MAX_CALLS);
		if (typeof calls === 'string') return { error: calls };
		const stepTokens = parseWhole(values.step ?? '', 'Tokens per step', 1, MAX_STEP_TOKENS);
		if (typeof stepTokens === 'string') return { error: stepTokens };
		const compactAbove = parseWhole(values.limit ?? '', 'The compaction limit', 1, MAX_THRESHOLD);
		if (typeof compactAbove === 'string') return { error: compactAbove };
		const smallestUseful = BASE_TOKENS + SUMMARY_TOKENS + stepTokens;
		if (compactAbove < smallestUseful)
			return { error: `Set the limit to at least ${smallestUseful}k: the ${BASE_TOKENS}k base, the ${SUMMARY_TOKENS}k summary, and one ${stepTokens}k step. Lower, and the agent would compact after every call.` };
		return { input: { calls, stepTokens, compactAbove } };
	},
	steps: buildSteps,
});
