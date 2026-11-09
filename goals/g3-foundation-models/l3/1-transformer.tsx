import { Canvas, Cell, Frame, RowLabel, SubLabel, type CellTone } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

interface GenerationInput {
	promptTokens: string[];
	outputTokens: string[];
}

type Phase = 'empty' | 'prefill' | 'decode' | 'summary';

interface CacheStep extends Step {
	phase: Phase;
	decodeStep: number;
}

type CacheSceneProps = SceneProps<GenerationInput, CacheStep>;

const KIB_PER_TOKEN = 128;
const MAX_PROMPT_TOKENS = 4;
const MAX_OUTPUT_TOKENS = 5;
const MAX_TOKEN_LENGTH = 6;

const TOKEN_TOP = 40;
const KEY_TOP = 136;
const VALUE_TOP = 200;
const SCENE_HEIGHT = 270;

const quoted = (token: string) => `'${token}'`;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function cachedTokenCount({ promptTokens }: GenerationInput, { phase, decodeStep }: CacheStep) {
	if (phase === 'empty') return 0;
	return promptTokens.length + decodeStep;
}

function computationsWithCache(promptLength: number, decodeStep: number) {
	return promptLength + decodeStep;
}

function computationsWithoutCache(promptLength: number, decodeStep: number) {
	let total = promptLength;
	for (let step = 1; step <= decodeStep; step++) total += promptLength + step;
	return total;
}

const memoryOf = (tokens: number) => (tokens * KIB_PER_TOKEN >= 1024 ? `${((tokens * KIB_PER_TOKEN) / 1024).toFixed(2)} MiB` : `${tokens * KIB_PER_TOKEN} KiB`);

function readoutFor(input: GenerationInput, step: CacheStep) {
	const cached = cachedTokenCount(input, step);
	const promptLength = input.promptTokens.length;
	const started = step.phase !== 'empty';
	return {
		'tokens cached': cached,
		'cache size (Llama 3 8B)': memoryOf(cached),
		'K/V computed, with cache': started ? computationsWithCache(promptLength, step.decodeStep) : 0,
		'K/V computed, no cache': started ? computationsWithoutCache(promptLength, step.decodeStep) : 0,
	};
}

function prefillNarration({ promptTokens, outputTokens }: GenerationInput) {
	return `<b>Prefill.</b> One forward pass reads the ${plural(promptTokens.length, 'prompt token')} in parallel and computes a key and a value for each, in every layer. They go into the cache. The same pass predicts the first output token, ${quoted(outputTokens[0])}. This pass is a big matrix-matrix multiply, so it keeps the GPU's compute busy; its duration is the time to first token.`;
}

function decodeNarration({ promptTokens, outputTokens }: GenerationInput, decodeStep: number) {
	const fedToken = outputTokens[decodeStep - 1];
	const earlier = promptTokens.length + decodeStep - 1;
	const nextToken = outputTokens[decodeStep];
	const withoutCache = promptTokens.length + decodeStep;
	return `<b>Decode step ${decodeStep}.</b> The model reads ${quoted(fedToken)}, the token it just produced, and computes a key and a value for that one token only. The keys and values of the ${plural(earlier, 'earlier token')} come from the cache: the causal mask means an earlier token never attends to a later one, so its keys and values never change. The new token's query is scored against all ${earlier + 1} keys, and the weighted sum of the ${earlier + 1} values predicts ${quoted(nextToken)}. With no cache, this step would recompute all ${withoutCache} keys and values.`;
}

function summaryNarration(input: GenerationInput) {
	const decodeSteps = input.outputTokens.length - 1;
	const promptLength = input.promptTokens.length;
	const cached = promptLength + decodeSteps;
	const withCache = computationsWithCache(promptLength, decodeSteps);
	const withoutCache = computationsWithoutCache(promptLength, decodeSteps);
	return `Done: ${plural(input.outputTokens.length, 'token')} generated. The cache holds ${plural(cached, 'token')} (the last output token gets its keys and values only if generation continues). With the cache the model computed ${plural(withCache, 'key/value pair')}, one per token; without it, ${withoutCache}, a count that grows with the square of the length. The price is memory: in Llama 3 8B each cached token costs ${KIB_PER_TOKEN} KiB (2 × 32 layers × 8 KV heads × 128 dimensions × 2 bytes), so an 8,192-token conversation holds 1 GiB, and every concurrent conversation holds its own.`;
}

function buildSteps(input: GenerationInput): CacheStep[] {
	const steps: CacheStep[] = [];
	const push = (phase: Phase, decodeStep: number, narration: string) => {
		const step: CacheStep = { phase, decodeStep, narration, readout: {} };
		step.readout = readoutFor(input, step);
		steps.push(step);
	};
	push(
		'empty',
		0,
		`The prompt is ${input.promptTokens.map(quoted).join(' ')}, one word per token here for readability. In every layer, attention turns each token into a query, a key, and a value. The <b>KV cache</b> is the store of keys and values of every token processed so far, kept in GPU memory so that each new token needs to compute only its own. It is empty before the request starts.`,
	);
	push('prefill', 0, prefillNarration(input));
	for (let decodeStep = 1; decodeStep < input.outputTokens.length; decodeStep++) push('decode', decodeStep, decodeNarration(input, decodeStep));
	push('summary', input.outputTokens.length - 1, summaryNarration(input));
	return steps;
}

function tokenVisible(column: number, promptLength: number, { phase, decodeStep }: CacheStep) {
	if (column < promptLength) return true;
	if (phase === 'empty') return false;
	return column - promptLength <= decodeStep;
}

function cacheTone(column: number, promptLength: number, { phase, decodeStep }: CacheStep): CellTone {
	if (phase === 'prefill') return 'add';
	if (phase !== 'decode') return 'plain';
	const newest = promptLength + decodeStep - 1;
	return column === newest ? 'add' : 'focus';
}

function CacheScene({ input, step }: CacheSceneProps) {
	const tokens = [...input.promptTokens, ...input.outputTokens];
	const promptLength = input.promptTokens.length;
	const cached = cachedTokenCount(input, step);
	const newestOutput = step.phase === 'empty' ? -1 : promptLength + step.decodeStep;
	return (
		<Canvas columns={tokens.length} height={SCENE_HEIGHT}>
			<RowLabel top={TOKEN_TOP + 16}>token</RowLabel>
			<RowLabel top={KEY_TOP + 16}>key</RowLabel>
			<RowLabel top={VALUE_TOP + 16}>value</RowLabel>
			<Frame startColumn={0} columns={promptLength} top={TOKEN_TOP - 8} label="prompt" />
			{tokens.map((token, column) => {
				const isCached = column < cached;
				const tone = isCached ? cacheTone(column, promptLength, step) : 'plain';
				return [
					<Cell
						key={`token-${column}`}
						value={token}
						column={column}
						top={TOKEN_TOP}
						tone={column === newestOutput && step.phase !== 'summary' ? 'add' : 'plain'}
						hidden={!tokenVisible(column, promptLength, step)}
					/>,
					<SubLabel key={`position-${column}`} column={column} top={TOKEN_TOP + 60} hidden={!tokenVisible(column, promptLength, step)}>
						{column < promptLength ? `pos ${column + 1}` : `out ${column - promptLength + 1}`}
					</SubLabel>,
					<Cell key={`key-${column}`} value={`k${column + 1}`} column={column} top={KEY_TOP} tone={tone} hidden={!isCached} />,
					<Cell key={`value-${column}`} value={`v${column + 1}`} column={column} top={VALUE_TOP} tone={tone} hidden={!isCached} />,
				];
			})}
		</Canvas>
	);
}

function parseTokens(raw: string, label: string, maxCount: number): string[] | string {
	const tokens = raw.split(/\s+/).filter(Boolean);
	if (tokens.length === 0 || tokens.length > maxCount) return `Enter 1 to ${maxCount} ${label} words, separated by spaces.`;
	if (tokens.some((token) => token.length > MAX_TOKEN_LENGTH)) return `Keep each word to ${MAX_TOKEN_LENGTH} characters so it fits in a cell.`;
	return tokens;
}

export default defineExplainer<GenerationInput, CacheStep>({
	title: 'The KV cache grows as the model generates',
	stages: [
		{
			title: 'One request, token by token',
			subtitle: 'Green: keys and values computed in this step. Blue: keys and values read from the cache. Each key and value cell stands for that token across all layers and KV heads.',
			Scene: CacheScene,
		},
	],
	examples: [
		{ input: { promptTokens: ['The', 'cat', 'sat'], outputTokens: ['on', 'the', 'warm', 'mat'] }, note: 'Short prompt' },
		{ input: { promptTokens: ['Name', 'a', 'blue', 'fruit'], outputTokens: ['A', 'plum', '.'] }, note: 'Longer prompt, short answer' },
	],
	fields: [
		{ name: 'prompt', label: 'prompt words', placeholder: 'e.g. The cat sat' },
		{ name: 'output', label: 'generated words', placeholder: 'e.g. on the mat' },
	],
	describe: ({ promptTokens, outputTokens }) => `${promptTokens.join(' ')} → ${outputTokens.join(' ')}`,
	parse(values) {
		const promptTokens = parseTokens(values.prompt, 'prompt', MAX_PROMPT_TOKENS);
		if (typeof promptTokens === 'string') return { error: promptTokens };
		const outputTokens = parseTokens(values.output, 'generated', MAX_OUTPUT_TOKENS);
		if (typeof outputTokens === 'string') return { error: outputTokens };
		return { input: { promptTokens, outputTokens } };
	},
	steps: buildSteps,
});
