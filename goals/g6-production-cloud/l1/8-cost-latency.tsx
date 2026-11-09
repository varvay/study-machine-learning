import { Canvas, Cell, ColumnMarker, Frame, RowLabel, SubLabel, type CellTone } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

interface RequestInput {
	chunkCount: number;
	chunkTokens: number;
	answerTokens: number;
}

interface Hop {
	name: string;
	milliseconds: number;
	onUserPath: boolean;
	tokensLabel: string;
	costLabel: string;
	dollarsPerThousand: number;
}

type Phase = 'intro' | 'hop' | 'summary';

interface RequestStep extends Step {
	phase: Phase;
	reachedHops: number;
}

type RequestSceneProps = SceneProps<RequestInput, RequestStep>;

const QUESTION_TOKENS = 20;
const SYSTEM_PROMPT_TOKENS = 200;

const EMBEDDING_DOLLARS_PER_MILLION = 0.02;
const INPUT_DOLLARS_PER_MILLION = 2;
const OUTPUT_DOLLARS_PER_MILLION = 10;

const EMBED_MILLISECONDS = 30;
const RETRIEVE_MILLISECONDS = 20;
const BUILD_PROMPT_MILLISECONDS = 1;
const FIRST_TOKEN_BASE_MILLISECONDS = 250;
const MILLISECONDS_PER_INPUT_TOKEN = 0.1;
const MILLISECONDS_PER_OUTPUT_TOKEN = 20;

const DEFAULT_INPUT: RequestInput = { chunkCount: 4, chunkTokens: 350, answerTokens: 300 };
const LIMITS = {
	chunkCount: { min: 1, max: 50 },
	chunkTokens: { min: 50, max: 2000 },
	answerTokens: { min: 1, max: 4000 },
};

const HOP_TOP = 40;
const NAME_TOP = 98;
const TIME_TOP = 130;
const TOKENS_TOP = 152;
const COST_TOP = 174;
const SCENE_HEIGHT = 200;

const FIRST_TOKEN_HOP = 3;
const STREAM_HOP = 4;

const thousands = new Intl.NumberFormat('en-US');
const formatCount = (count: number) => thousands.format(count);
const formatMilliseconds = (milliseconds: number) => (milliseconds >= 1000 ? `${(milliseconds / 1000).toFixed(2)} s` : `${Math.round(milliseconds)} ms`);
const formatDollars = (dollars: number) => (dollars >= 0.01 ? `$${dollars.toFixed(2)}` : `$${Number(dollars.toPrecision(1))}`);
const percent = (part: number, whole: number) => Math.round((part / whole) * 100);
const tokenCount = (count: number) => `${formatCount(count)} token${count === 1 ? '' : 's'}`;

const dollarsPerThousandRequests = (tokens: number, dollarsPerMillion: number) => (tokens * dollarsPerMillion) / 1000;
const inputTokensOf = ({ chunkCount, chunkTokens }: RequestInput) => SYSTEM_PROMPT_TOKENS + QUESTION_TOKENS + chunkCount * chunkTokens;
const firstTokenMillisecondsOf = (inputTokens: number) => Math.round(FIRST_TOKEN_BASE_MILLISECONDS + MILLISECONDS_PER_INPUT_TOKEN * inputTokens);
const streamMillisecondsOf = (answerTokens: number) => MILLISECONDS_PER_OUTPUT_TOKEN * (answerTokens - 1);

function hopsOf(input: RequestInput): Hop[] {
	const inputTokens = inputTokensOf(input);
	const embedDollars = dollarsPerThousandRequests(QUESTION_TOKENS, EMBEDDING_DOLLARS_PER_MILLION);
	const inputDollars = dollarsPerThousandRequests(inputTokens, INPUT_DOLLARS_PER_MILLION);
	const outputDollars = dollarsPerThousandRequests(input.answerTokens, OUTPUT_DOLLARS_PER_MILLION);
	return [
		{ name: 'embed', milliseconds: EMBED_MILLISECONDS, onUserPath: true, tokensLabel: `${QUESTION_TOKENS} in`, costLabel: formatDollars(embedDollars), dollarsPerThousand: embedDollars },
		{ name: 'retrieve', milliseconds: RETRIEVE_MILLISECONDS, onUserPath: true, tokensLabel: `${input.chunkCount}×${input.chunkTokens}`, costLabel: 'hourly', dollarsPerThousand: 0 },
		{ name: 'prompt', milliseconds: BUILD_PROMPT_MILLISECONDS, onUserPath: true, tokensLabel: formatCount(inputTokens), costLabel: '–', dollarsPerThousand: 0 },
		{ name: '1st token', milliseconds: firstTokenMillisecondsOf(inputTokens), onUserPath: true, tokensLabel: `${formatCount(inputTokens)} in`, costLabel: formatDollars(inputDollars), dollarsPerThousand: inputDollars },
		{ name: 'stream', milliseconds: streamMillisecondsOf(input.answerTokens), onUserPath: true, tokensLabel: `${formatCount(input.answerTokens)} out`, costLabel: formatDollars(outputDollars), dollarsPerThousand: outputDollars },
		{ name: 'log', milliseconds: 0, onUserPath: false, tokensLabel: '–', costLabel: 'hourly', dollarsPerThousand: 0 },
	];
}

const elapsedAfter = (hops: Hop[], reachedHops: number) =>
	hops.slice(0, reachedHops).reduce((sum, hop) => (hop.onUserPath ? sum + hop.milliseconds : sum), 0);
const costAfter = (hops: Hop[], reachedHops: number) => hops.slice(0, reachedHops).reduce((sum, hop) => sum + hop.dollarsPerThousand, 0);
const firstWordMilliseconds = (hops: Hop[]) => elapsedAfter(hops, FIRST_TOKEN_HOP + 1);

function introNarration(input: RequestInput) {
	return `One user question travels through a RAG app, hop by hop. Its prompt holds a ${SYSTEM_PROMPT_TOKENS}-token system prompt, the ${QUESTION_TOKENS}-token question, and ${input.chunkCount} retrieved chunks of ${formatCount(input.chunkTokens)} tokens; the answer is ${formatCount(input.answerTokens)} tokens. Prices are list prices: $${EMBEDDING_DOLLARS_PER_MILLION} per million tokens for the embedding model (OpenAI text-embedding-3-small), and $${INPUT_DOLLARS_PER_MILLION} per million input and $${OUTPUT_DOLLARS_PER_MILLION} per million output tokens for the chat model (Claude Sonnet 5.5). Timings are illustrative, not measured: the model needs ${FIRST_TOKEN_BASE_MILLISECONDS} ms plus ${MILLISECONDS_PER_INPUT_TOKEN} ms per prompt token before its first token, then ${MILLISECONDS_PER_OUTPUT_TOKEN} ms per output token. Costs are per 1,000 requests, since one request costs a fraction of a cent.`;
}

function hopNarration(input: RequestInput, hops: Hop[], index: number) {
	const inputTokens = inputTokensOf(input);
	const hop = hops[index];
	switch (index) {
		case 0:
			return `Hop 1, embed the question: the app sends the ${QUESTION_TOKENS}-token question to an embedding model and gets back its vector (G1.7). About ${EMBED_MILLISECONDS} ms, mostly the network round trip. Cost: ${QUESTION_TOKENS} tokens × $${EMBEDDING_DOLLARS_PER_MILLION} per million = ${hop.costLabel} per 1,000 requests, too small to matter.`;
		case 1:
			return `Hop 2, retrieve: the vector store finds the ${input.chunkCount} chunks nearest the question's vector, using its index. About ${RETRIEVE_MILLISECONDS} ms. Nothing is billed per request here: the database's servers are paid by the hour, whether they serve 10 questions or 10,000.`;
		case 2: {
			const chunkShare = percent(input.chunkCount * input.chunkTokens, inputTokens);
			return `Hop 3, build the prompt: the app joins the system prompt (${SYSTEM_PROMPT_TOKENS} tokens), the question (${QUESTION_TOKENS}), and ${input.chunkCount} chunks × ${formatCount(input.chunkTokens)} tokens into one prompt of ${formatCount(inputTokens)} tokens. It takes about ${BUILD_PROMPT_MILLISECONDS} ms and costs nothing yet, but it fixes the next hop's bill: ${chunkShare}% of the prompt is retrieved chunks.`;
		}
		case 3:
			return `Hop 4, the model reads the prompt and writes its first token. It reads all ${formatCount(inputTokens)} input tokens in one parallel pass, so a longer prompt mostly delays the first token: ${FIRST_TOKEN_BASE_MILLISECONDS} + ${MILLISECONDS_PER_INPUT_TOKEN} × ${formatCount(inputTokens)} ≈ ${formatMilliseconds(hop.milliseconds)} here. Input cost: ${formatCount(inputTokens)} tokens × $${INPUT_DOLLARS_PER_MILLION} per million = ${hop.costLabel} per 1,000 requests. With streaming, the user sees the first word now, ${formatMilliseconds(firstWordMilliseconds(hops))} after asking.`;
		case 4: {
			const remaining = input.answerTokens - 1;
			const timing =
				remaining === 0
					? 'The answer is a single token, already sent, so nothing is left to stream.'
					: `The model writes the remaining ${tokenCount(remaining)} one at a time, each depending on the ones before: ${MILLISECONDS_PER_OUTPUT_TOKEN} ms × ${formatCount(remaining)} = ${formatMilliseconds(hop.milliseconds)}.`;
			return `Hop 5, stream the answer. ${timing} Output cost: ${tokenCount(input.answerTokens)} × $${OUTPUT_DOLLARS_PER_MILLION} per million = ${hop.costLabel} per 1,000 requests; each output token costs ${OUTPUT_DOLLARS_PER_MILLION / INPUT_DOLLARS_PER_MILLION} times an input token. The last word arrives ${formatMilliseconds(elapsedAfter(hops, STREAM_HOP + 1))} after asking.`;
		}
		default:
			return `Hop 6, log the trace: the app records one span per hop with its duration, the token counts, the model version, and the cost (G6.6). It runs after the answer is sent, off the user's path, so it adds no wait; its storage is paid by the hour or by the gigabyte.`;
	}
}

function summaryNarration(input: RequestInput, hops: Hop[]) {
	const totalMilliseconds = elapsedAfter(hops, hops.length);
	const totalDollars = costAfter(hops, hops.length);
	const streamShare = percent(hops[STREAM_HOP].milliseconds, totalMilliseconds);
	const inputShare = percent(hops[FIRST_TOKEN_HOP].dollarsPerThousand, totalDollars);
	const outputShare = percent(hops[STREAM_HOP].dollarsPerThousand, totalDollars);
	const chunksFillPrompt = input.chunkCount * input.chunkTokens > inputTokensOf(input) / 2;
	const costDriver =
		inputShare <= outputShare
			? 'Most of the bill is the answer: shorter answers cut it.'
			: chunksFillPrompt
				? 'Most of the bill is the prompt, and most of the prompt is retrieved chunks: fewer or shorter chunks cut it.'
				: 'Most of the bill is the prompt: a shorter system prompt or fewer chunks cut it.';
	const timing =
		input.answerTokens === 1
			? `the first and only word appears after ${formatMilliseconds(totalMilliseconds)}; a one-token answer has nothing to stream.`
			: `the first word appears after ${formatMilliseconds(firstWordMilliseconds(hops))} and the last after ${formatMilliseconds(totalMilliseconds)}; streaming the answer takes ${streamShare}% of that time.`;
	return `Total: ${timing} The request costs ${formatDollars(totalDollars)} per 1,000: ${inputShare}% for input tokens, ${outputShare}% for output. ${costDriver} The steps before the model (embedding, retrieval, prompt) add only ${formatMilliseconds(elapsedAfter(hops, FIRST_TOKEN_HOP))} and almost no cost.`;
}

function buildSteps(input: RequestInput): RequestStep[] {
	const hops = hopsOf(input);
	const readoutAt = (reachedHops: number) => ({
		elapsed: formatMilliseconds(elapsedAfter(hops, reachedHops)),
		'first word': reachedHops > FIRST_TOKEN_HOP ? formatMilliseconds(firstWordMilliseconds(hops)) : '–',
		'cost per 1k': formatDollars(costAfter(hops, reachedHops)),
	});
	const steps: RequestStep[] = [{ phase: 'intro', reachedHops: 0, readout: readoutAt(0), narration: introNarration(input) }];
	hops.forEach((_, index) => steps.push({ phase: 'hop', reachedHops: index + 1, readout: readoutAt(index + 1), narration: hopNarration(input, hops, index) }));
	steps.push({ phase: 'summary', reachedHops: hops.length, readout: readoutAt(hops.length), narration: summaryNarration(input, hops) });
	return steps;
}

function hopTone(index: number, { phase, reachedHops }: RequestStep): CellTone {
	if (phase === 'hop' && index === reachedHops - 1) return 'focus';
	return 'plain';
}

function RequestScene({ input, step }: RequestSceneProps) {
	const hops = hopsOf(input);
	const { phase, reachedHops } = step;
	const current = reachedHops - 1;
	return (
		<Canvas columns={hops.length} height={SCENE_HEIGHT}>
			<RowLabel top={HOP_TOP + 16}>hop</RowLabel>
			<RowLabel top={TIME_TOP - 2}>time</RowLabel>
			<RowLabel top={TOKENS_TOP - 2}>tokens</RowLabel>
			<RowLabel top={COST_TOP - 2}>$ per 1k</RowLabel>
			{phase === 'summary' ? (
				<Frame startColumn={0} columns={FIRST_TOKEN_HOP + 1} top={HOP_TOP - 8} label={`the user waits ${formatMilliseconds(firstWordMilliseconds(hops))} for the first word`} />
			) : (
				<ColumnMarker column={Math.max(current, 0)} top={HOP_TOP - 8} height={84} label="now" hidden={phase === 'intro'} />
			)}
			{hops.map((hop, index) => {
				const reached = index < reachedHops;
				return [
					<Cell key={`hop-${index}`} value={index + 1} column={index} top={HOP_TOP} tone={hopTone(index, step)} dimmed={!reached} />,
					<SubLabel key={`name-${index}`} column={index} top={NAME_TOP}>
						{hop.name}
					</SubLabel>,
					<SubLabel key={`time-${index}`} column={index} top={TIME_TOP} hidden={!reached}>
						{hop.onUserPath ? formatMilliseconds(hop.milliseconds) : 'after'}
					</SubLabel>,
					<SubLabel key={`tokens-${index}`} column={index} top={TOKENS_TOP} hidden={!reached}>
						{hop.tokensLabel}
					</SubLabel>,
					<SubLabel key={`cost-${index}`} column={index} top={COST_TOP} hidden={!reached}>
						{hop.costLabel}
					</SubLabel>,
				];
			})}
		</Canvas>
	);
}

function parseWholeNumber(raw: string, fallback: number, { min, max }: { min: number; max: number }, message: string): number | string {
	if (raw.trim() === '') return fallback;
	const value = Number(raw.replace(/,/g, ''));
	if (!Number.isInteger(value) || value < min || value > max) return message;
	return value;
}

export default defineExplainer<RequestInput, RequestStep>({
	title: 'Where a RAG request spends time and money',
	stages: [
		{
			title: 'One question, six hops',
			subtitle: 'Each numbered block is one hop of a single request. Below it: the time it adds, the tokens it handles, and its cost per 1,000 requests ("hourly" means paid by the hour, not per request).',
			Scene: RequestScene,
		},
	],
	examples: [
		{ input: DEFAULT_INPUT, note: 'A typical answer' },
		{ input: { chunkCount: 20, chunkTokens: 500, answerTokens: 300 }, note: 'Stuffed context: 20 chunks' },
		{ input: { chunkCount: 4, chunkTokens: 350, answerTokens: 40 }, note: 'A short answer' },
	],
	fields: [
		{ name: 'chunks', label: 'retrieved chunks (top-k)', placeholder: String(DEFAULT_INPUT.chunkCount) },
		{ name: 'chunkTokens', label: 'tokens per chunk', placeholder: String(DEFAULT_INPUT.chunkTokens) },
		{ name: 'answerTokens', label: 'answer tokens', placeholder: String(DEFAULT_INPUT.answerTokens) },
	],
	describe: ({ chunkCount, chunkTokens, answerTokens }) => `${chunkCount} chunks × ${chunkTokens} tokens, ${answerTokens}-token answer`,
	parse(values) {
		const chunkCount = parseWholeNumber(values.chunks ?? '', DEFAULT_INPUT.chunkCount, LIMITS.chunkCount, 'Retrieved chunks is a whole number from 1 to 50.');
		if (typeof chunkCount === 'string') return { error: chunkCount };
		const chunkTokens = parseWholeNumber(values.chunkTokens ?? '', DEFAULT_INPUT.chunkTokens, LIMITS.chunkTokens, 'Tokens per chunk is a whole number from 50 to 2,000.');
		if (typeof chunkTokens === 'string') return { error: chunkTokens };
		const answerTokens = parseWholeNumber(values.answerTokens ?? '', DEFAULT_INPUT.answerTokens, LIMITS.answerTokens, 'Answer tokens is a whole number from 1 to 4,000.');
		if (typeof answerTokens === 'string') return { error: answerTokens };
		return { input: { chunkCount, chunkTokens, answerTokens } };
	},
	steps: buildSteps,
});
