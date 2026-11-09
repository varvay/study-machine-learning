import { Canvas, Cell, Frame, Plane, RowLabel, SubLabel, columnLeft, type CellTone } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

interface SamplingInput {
	temperature: number;
	topP: number;
}

type Phase = 'model' | 'temperature' | 'top-p' | 'draw';

interface SamplingStep extends Step {
	phase: Phase;
}

type SamplingSceneProps = SceneProps<SamplingInput, SamplingStep>;

interface Candidate {
	token: string;
	probability: number;
}

interface Distributions {
	model: number[];
	tempered: number[];
	keptCount: number;
	drawn: number[];
}

const PROMPT = 'The cat sat on the';
const CANDIDATES: Candidate[] = [
	{ token: 'mat', probability: 0.5 },
	{ token: 'floor', probability: 0.2 },
	{ token: 'sofa', probability: 0.12 },
	{ token: 'bed', probability: 0.08 },
	{ token: 'roof', probability: 0.06 },
	{ token: 'moon', probability: 0.04 },
];
const MAX_TEMPERATURE = 2;
const SUM_TOLERANCE = 1e-9;

const BAR_TOP = 10;
const BAR_MAX_HEIGHT = 120;
const BAR_WIDTH = 38;
const CELL_TOP = BAR_TOP + BAR_MAX_HEIGHT + 40;
const WORD_TOP = CELL_TOP + 62;
const RUNNING_SUM_TOP = CELL_TOP + 80;
const SCENE_HEIGHT = RUNNING_SUM_TOP + 26;

function applyTemperature(probabilities: number[], temperature: number): number[] {
	if (temperature === 0) {
		const best = probabilities.indexOf(Math.max(...probabilities));
		return probabilities.map((_, index) => (index === best ? 1 : 0));
	}
	const reshaped = probabilities.map((probability) => probability ** (1 / temperature));
	const total = reshaped.reduce((sum, value) => sum + value, 0);
	return reshaped.map((value) => value / total);
}

const runningSums = (probabilities: number[]) => probabilities.map((_, index) => probabilities.slice(0, index + 1).reduce((sum, value) => sum + value, 0));

function nucleusSize(sortedProbabilities: number[], topP: number): number {
	const reached = runningSums(sortedProbabilities).findIndex((sum) => sum >= topP - SUM_TOLERANCE);
	return reached < 0 ? sortedProbabilities.length : reached + 1;
}

function distributionsOf({ temperature, topP }: SamplingInput): Distributions {
	const model = CANDIDATES.map((candidate) => candidate.probability);
	const tempered = applyTemperature(model, temperature);
	const keptCount = nucleusSize(tempered, topP);
	const keptTotal = tempered.slice(0, keptCount).reduce((sum, value) => sum + value, 0);
	const drawn = tempered.map((probability, index) => (index < keptCount ? probability / keptTotal : 0));
	return { model, tempered, keptCount, drawn };
}

function formatPercent(probability: number): string {
	const value = probability * 100;
	if (value >= 99.95) return '100';
	if (value >= 9.95 || value === 0) return value.toFixed(0);
	return value.toFixed(1);
}

const spoken = (probability: number) => `${formatPercent(probability)}%`;
const spokenPrecisely = (probability: number) => `${(probability * 100).toFixed(1)}%`;
const quoted = (index: number) => `"${CANDIDATES[index].token}"`;
const lastIndex = CANDIDATES.length - 1;

function modelNarration() {
	return `After the prompt "${PROMPT}", the model gives every token in its vocabulary a probability of coming next. Six candidates are shown; treat them as the only ones. ${quoted(0)} is the most likely at ${spoken(CANDIDATES[0].probability)}. The bars show the probabilities.`;
}

function temperatureNarration({ temperature }: SamplingInput, { model, tempered }: Distributions) {
	if (temperature === 0)
		return `Temperature 0 means greedy decoding: the most likely token, ${quoted(0)}, gets 100% and every other token 0%. The same prompt then gives the same continuation on (almost) every run.`;
	if (temperature === 1) return 'Temperature 1 leaves the model\'s probabilities unchanged.';
	const top = `${quoted(0)} goes from ${spoken(model[0])} to ${spoken(tempered[0])}`;
	const rare = `${quoted(lastIndex)} from ${spoken(model[lastIndex])} to ${spoken(tempered[lastIndex])}`;
	if (temperature < 1)
		return `Temperature ${temperature} sharpens the distribution: likely tokens gain and unlikely ones shrink. ${top}; ${rare}. The output becomes more predictable.`;
	return `Temperature ${temperature} flattens the distribution: unlikely tokens gain at the expense of likely ones. ${top}; ${rare}. The output becomes more varied, and more often odd or wrong.`;
}

function topPNarration({ topP }: SamplingInput, { tempered, keptCount }: Distributions) {
	if (keptCount === CANDIDATES.length) return `Top-p ${topP}: the running sum reaches ${spoken(topP)} only with the last token, so every candidate stays and nothing is cut.`;
	const sums = runningSums(tempered);
	const kept = CANDIDATES.slice(0, keptCount).map((_, index) => quoted(index));
	const cut = CANDIDATES.length - keptCount;
	const cutTotal = 1 - sums[keptCount - 1];
	const others = `The other ${cut} token${cut === 1 ? '' : 's'}`;
	const cutPart = cutTotal < 0.0005 ? `${others} already had 0%.` : `${others}, holding ${spokenPrecisely(cutTotal)} together, ${cut === 1 ? 'is' : 'are'} cut.`;
	if (keptCount === 1) return `Top-p ${topP}: sort the tokens from most to least likely and keep adding them until their probabilities sum to at least ${spoken(topP)}. ${quoted(0)} alone holds ${spoken(tempered[0])}, so it is the only token kept. ${cutPart}`;
	return `Top-p ${topP}: sort the tokens from most to least likely and keep adding them until their probabilities sum to at least ${spoken(topP)}. ${kept.join(' + ')} reach ${spokenPrecisely(sums[keptCount - 1])}, so these ${keptCount} tokens form the nucleus. ${cutPart}`;
}

function drawNarration({ drawn, keptCount }: Distributions) {
	if (keptCount === 1) return `Only ${quoted(0)} is left, so it is chosen every time. Then it is appended to the text, and the model predicts the token after it.`;
	const chances = drawn
		.slice(0, keptCount)
		.map((probability, index) => `${quoted(index)} ${spoken(probability)}`)
		.join(', ');
	const perHundred = Math.round(drawn[0] * 100);
	return `The kept tokens are rescaled to add up to 100%, and the next token is drawn at random with these chances: ${chances}. Run the prompt 100 times and about ${perHundred} runs continue with ${quoted(0)}. The drawn token is appended to the text, and the model predicts the token after it.`;
}

function buildSteps(input: SamplingInput): SamplingStep[] {
	const distributions = distributionsOf(input);
	const settings = { temperature: input.temperature, 'top-p': input.topP };
	return [
		{ phase: 'model', readout: { ...settings, kept: '–' }, narration: modelNarration() },
		{ phase: 'temperature', readout: { ...settings, kept: '–' }, narration: temperatureNarration(input, distributions) },
		{ phase: 'top-p', readout: { ...settings, kept: distributions.keptCount }, narration: topPNarration(input, distributions) },
		{ phase: 'draw', readout: { ...settings, kept: distributions.keptCount }, narration: drawNarration(distributions) },
	];
}

function probabilitiesAt(phase: Phase, distributions: Distributions): number[] {
	if (phase === 'model') return distributions.model;
	if (phase === 'draw') return distributions.drawn;
	return distributions.tempered;
}

function SamplingScene({ input, step: { phase } }: SamplingSceneProps) {
	const distributions = distributionsOf(input);
	const probabilities = probabilitiesAt(phase, distributions);
	const sums = runningSums(distributions.tempered);
	const cutting = phase === 'top-p' || phase === 'draw';
	const isKept = (index: number) => index < distributions.keptCount;
	const cellTone = (index: number): CellTone => {
		if (!cutting) return 'plain';
		return isKept(index) ? 'add' : 'remove';
	};

	return (
		<Canvas columns={CANDIDATES.length} height={SCENE_HEIGHT}>
			<RowLabel top={CELL_TOP + 16}>chance %</RowLabel>
			<RowLabel top={WORD_TOP}>next token</RowLabel>
			<RowLabel top={RUNNING_SUM_TOP} hidden={phase !== 'top-p'}>
				sum so far
			</RowLabel>
			{cutting && <Frame startColumn={0} columns={distributions.keptCount} top={CELL_TOP - 8} label={`kept by top-p ${input.topP}`} />}
			{probabilities.map((probability, index) => {
				const height = probability * BAR_MAX_HEIGHT;
				if (height < 1) return null;
				return (
					<Plane
						key={`bar-${index}`}
						left={columnLeft(index) + 8}
						top={BAR_TOP + BAR_MAX_HEIGHT - height}
						width={BAR_WIDTH}
						height={height}
						label=""
						active={!cutting || isKept(index)}
					/>
				);
			})}
			{CANDIDATES.map((candidate, index) => [
				<Cell
					key={`cell-${index}`}
					value={formatPercent(probabilities[index])}
					column={index}
					top={CELL_TOP}
					tone={cellTone(index)}
					dimmed={cutting && !isKept(index)}
				/>,
				<SubLabel key={`token-${index}`} column={index} top={WORD_TOP}>
					{candidate.token}
				</SubLabel>,
				<SubLabel key={`sum-${index}`} column={index} top={RUNNING_SUM_TOP} hidden={phase !== 'top-p'}>
					{formatPercent(sums[index])}
				</SubLabel>,
			])}
		</Canvas>
	);
}

export default defineExplainer<SamplingInput, SamplingStep>({
	title: 'Temperature and top-p reshape the next-token odds',
	stages: [
		{
			title: `Choosing the token after "${PROMPT}"`,
			subtitle: 'Bars and cells show each candidate\'s chance of being picked. Temperature reshapes all the chances; top-p then keeps only the most likely tokens (green) and cuts the rest (red).',
			Scene: SamplingScene,
		},
	],
	examples: [
		{ input: { temperature: 1, topP: 1 }, note: 'The model\'s own odds' },
		{ input: { temperature: 0.5, topP: 1 }, note: 'Low temperature: sharper' },
		{ input: { temperature: 1.5, topP: 1 }, note: 'High temperature: flatter' },
		{ input: { temperature: 1, topP: 0.8 }, note: 'Top-p 0.8 cuts the tail' },
		{ input: { temperature: 0, topP: 1 }, note: 'Temperature 0: greedy' },
	],
	fields: [
		{ name: 'temperature', label: 'temperature', placeholder: `0 to ${MAX_TEMPERATURE}, e.g. 0.7` },
		{ name: 'topP', label: 'top-p', placeholder: 'above 0, up to 1, e.g. 0.9' },
	],
	describe: ({ temperature, topP }) => `temperature ${temperature} · top-p ${topP}`,
	parse(values) {
		const temperature = values.temperature.trim() === '' ? 1 : Number(values.temperature);
		if (!Number.isFinite(temperature) || temperature < 0 || temperature > MAX_TEMPERATURE) return { error: `Temperature is a number from 0 to ${MAX_TEMPERATURE}; leave it blank for 1.` };
		const topP = values.topP.trim() === '' ? 1 : Number(values.topP);
		if (!Number.isFinite(topP) || topP <= 0 || topP > 1) return { error: 'Top-p is a number above 0 and at most 1, such as 0.9; leave it blank for 1.' };
		return { input: { temperature, topP } };
	},
	steps: buildSteps,
});
