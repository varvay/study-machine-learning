import { Canvas, Cell, ColumnMarker, RowLabel, SubLabel, type CellTone } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

interface CacheInput {
	arrivalMinutes: number[];
	prefixTokens: number;
	dynamicTokens: number;
	outputTokens: number;
}

type Outcome = 'uncacheable' | 'write' | 'hit';

interface RequestResult {
	minute: number;
	outcome: Outcome;
	cachedCost: number;
	uncachedCost: number;
	expiresAt?: number;
}

interface CacheStep extends Step {
	processedCount: number;
}

type CacheSceneProps = SceneProps<CacheInput, CacheStep>;

const DOLLARS_PER_MILLION = { input: 1.1, output: 5.5, cacheWrite: 1.375, cacheRead: 0.11 };
const MINIMUM_PREFIX_TOKENS = 4096;
const TTL_MINUTES = 5;
const MAX_REQUESTS = 10;
const MAX_MINUTE = 120;

const REQUEST_TOP = 40;
const SCENE_HEIGHT = 170;

const perToken = (dollarsPerMillion: number) => dollarsPerMillion / 1_000_000;

function uncachedCost({ prefixTokens, dynamicTokens, outputTokens }: CacheInput) {
	return (prefixTokens + dynamicTokens) * perToken(DOLLARS_PER_MILLION.input) + outputTokens * perToken(DOLLARS_PER_MILLION.output);
}

function cachedCost(outcome: Outcome, input: CacheInput) {
	const { prefixTokens, dynamicTokens, outputTokens } = input;
	if (outcome === 'uncacheable') return uncachedCost(input);
	const prefixPrice = outcome === 'hit' ? DOLLARS_PER_MILLION.cacheRead : DOLLARS_PER_MILLION.cacheWrite;
	return prefixTokens * perToken(prefixPrice) + dynamicTokens * perToken(DOLLARS_PER_MILLION.input) + outputTokens * perToken(DOLLARS_PER_MILLION.output);
}

function simulate(input: CacheInput): RequestResult[] {
	const cacheable = input.prefixTokens >= MINIMUM_PREFIX_TOKENS;
	let expiresAt: number | undefined;
	return input.arrivalMinutes.map((minute) => {
		const outcome: Outcome = !cacheable ? 'uncacheable' : expiresAt !== undefined && minute < expiresAt ? 'hit' : 'write';
		if (cacheable) expiresAt = minute + TTL_MINUTES;
		return { minute, outcome, cachedCost: cachedCost(outcome, input), uncachedCost: uncachedCost(input), expiresAt };
	});
}

const cents = (dollars: number) => `${(dollars * 100).toFixed(3)}¢`;
const dollars = (amount: number) => `$${amount.toFixed(4)}`;
const tokens = (count: number) => count.toLocaleString('en-US');
const clock = (minute: number) => `minute ${minute}`;

function totals(results: RequestResult[]) {
	const withCache = results.reduce((sum, result) => sum + result.cachedCost, 0);
	const withoutCache = results.reduce((sum, result) => sum + result.uncachedCost, 0);
	return { withCache, withoutCache, saved: withoutCache === 0 ? 0 : 1 - withCache / withoutCache };
}

function readoutFor(results: RequestResult[]) {
	const { withCache, withoutCache, saved } = totals(results);
	return {
		requests: results.length,
		'with cache': dollars(withCache),
		'without cache': dollars(withoutCache),
		saved: `${(saved * 100).toFixed(0)}%`,
	};
}

function introNarration(input: CacheInput) {
	const { prefixTokens, dynamicTokens, outputTokens, arrivalMinutes } = input;
	const base = `${arrivalMinutes.length} requests arrive at the minutes shown. Each has a ${tokens(prefixTokens)}-token prefix that never changes (system prompt and tool definitions), ${tokens(dynamicTokens)} tokens that change every time (history, chunks, question), and a ${tokens(outputTokens)}-token answer. Prices: Claude Haiku 4.5 through the us. profile, $1.10 input, $5.50 output, $1.375 cache write, $0.11 cache read per million tokens. Without caching, every request costs ${cents(uncachedCost(input))}.`;
	if (prefixTokens < MINIMUM_PREFIX_TOKENS)
		return `${base} But the prefix is under Haiku 4.5's minimum of ${tokens(MINIMUM_PREFIX_TOKENS)} tokens per cache checkpoint, so nothing will be cached: the requests still succeed, at the normal price.`;
	return `${base} The cache entry lives ${TTL_MINUTES} minutes, and every hit resets that clock.`;
}

function requestNarration(result: RequestResult, previous: RequestResult | undefined, input: CacheInput) {
	const at = clock(result.minute);
	if (result.outcome === 'uncacheable') return `${at}: the prefix is too short to cache, so all ${tokens(input.prefixTokens + input.dynamicTokens)} input tokens pay $1.10 per million: ${cents(result.cachedCost)}.`;
	const until = `The entry now lives until ${clock(result.expiresAt!)}.`;
	if (result.outcome === 'hit')
		return `${at}: cache hit, since the entry lives until ${clock(previous!.expiresAt!)}. The ${tokens(input.prefixTokens)} prefix tokens are read at $0.11 per million instead of $1.10: ${cents(result.cachedCost)} instead of ${cents(result.uncachedCost)}. ${until}`;
	const reason = previous === undefined ? 'the cache is empty' : `the entry expired at ${clock(previous.expiresAt!)}`;
	return `${at}: cache miss, because ${reason}. The prefix is processed and written to the cache at $1.375 per million, 25% above the normal input price: ${cents(result.cachedCost)} instead of ${cents(result.uncachedCost)}. ${until}`;
}

function summaryNarration(results: RequestResult[], input: CacheInput) {
	const { withCache, withoutCache, saved } = totals(results);
	const hits = results.filter((result) => result.outcome === 'hit').length;
	const writes = results.filter((result) => result.outcome === 'write').length;
	if (writes === 0 && hits === 0) return `Total ${dollars(withCache)} either way: a prefix below the minimum is never cached. Lengthen the cached prefix or accept the normal price.`;
	const premiumPerWrite = input.prefixTokens * perToken(DOLLARS_PER_MILLION.cacheWrite - DOLLARS_PER_MILLION.input);
	const savingPerHit = input.prefixTokens * perToken(DOLLARS_PER_MILLION.input - DOLLARS_PER_MILLION.cacheRead);
	const verdict = saved > 0 ? `saving ${(saved * 100).toFixed(0)}%` : `costing ${(-saved * 100).toFixed(0)}% more`;
	return `${writes} ${writes === 1 ? 'write' : 'writes'} and ${hits} ${hits === 1 ? 'hit' : 'hits'}: ${dollars(withCache)} with caching against ${dollars(withoutCache)} without, ${verdict}. Each write adds ${cents(premiumPerWrite)} and each hit saves ${cents(savingPerHit)}, so caching pays when requests share the prefix at least every ${TTL_MINUTES} minutes.`;
}

function buildSteps(input: CacheInput): CacheStep[] {
	const results = simulate(input);
	const steps: CacheStep[] = [{ processedCount: 0, readout: readoutFor([]), narration: introNarration(input) }];
	results.forEach((result, index) =>
		steps.push({ processedCount: index + 1, readout: readoutFor(results.slice(0, index + 1)), narration: requestNarration(result, results[index - 1], input) }),
	);
	steps.push({ processedCount: results.length, readout: readoutFor(results), narration: summaryNarration(results, input) });
	return steps;
}

const outcomeTone: Record<Outcome, CellTone> = { uncacheable: 'plain', write: 'remove', hit: 'add' };
const outcomeLabel: Record<Outcome, string> = { uncacheable: 'no cache', write: 'write', hit: 'hit' };

function CacheScene({ input, step: { processedCount } }: CacheSceneProps) {
	const results = simulate(input);
	const current = processedCount - 1;
	return (
		<Canvas columns={results.length} height={SCENE_HEIGHT}>
			<RowLabel top={REQUEST_TOP + 16}>minute</RowLabel>
			<RowLabel top={REQUEST_TOP + 62}>cache</RowLabel>
			<RowLabel top={REQUEST_TOP + 82}>cost</RowLabel>
			{current >= 0 && current < results.length && <ColumnMarker key="current" column={current} top={REQUEST_TOP - 10} height={120} label="now" />}
			{results.map((result, index) => {
				const processed = index < processedCount;
				return [
					<Cell
						key={`request-${index}`}
						value={result.minute}
						column={index}
						top={REQUEST_TOP}
						tone={processed ? outcomeTone[result.outcome] : 'plain'}
						dimmed={!processed}
					/>,
					<SubLabel key={`outcome-${index}`} column={index} top={REQUEST_TOP + 62} hidden={!processed}>
						{outcomeLabel[result.outcome]}
					</SubLabel>,
					<SubLabel key={`cost-${index}`} column={index} top={REQUEST_TOP + 82} hidden={!processed}>
						{cents(result.cachedCost)}
					</SubLabel>,
				];
			})}
		</Canvas>
	);
}

function parseMinutes(raw: string): number[] | string {
	const minutes = raw
		.split(/[\s,]+/)
		.filter(Boolean)
		.map(Number);
	if (minutes.length === 0) return 'Enter at least one arrival minute.';
	if (minutes.length > MAX_REQUESTS) return `Use ${MAX_REQUESTS} requests or fewer.`;
	if (minutes.some((minute) => !Number.isInteger(minute) || minute < 0 || minute > MAX_MINUTE)) return `Minutes are whole numbers from 0 to ${MAX_MINUTE}.`;
	if (minutes.some((minute, index) => index > 0 && minute < minutes[index - 1])) return 'List the minutes in the order the requests arrive, earliest first.';
	return minutes;
}

function parseTokens(raw: string, label: string, min: number, max: number): number | string {
	const value = Number(raw.replace(/[,_]/g, '').trim());
	if (raw.trim() === '' || !Number.isInteger(value)) return `Enter the ${label} as a whole number of tokens.`;
	if (value < min || value > max) return `The ${label} must be from ${tokens(min)} to ${tokens(max)} tokens.`;
	return value;
}

export default defineExplainer<CacheInput, CacheStep>({
	title: 'Prompt caching over a stream of requests',
	stages: [
		{
			title: 'Hits, writes, and the 5-minute TTL',
			subtitle: 'Each block is one request, labeled with the minute it arrives. Green: the prefix came from the cache (hit). Red: the prefix was written to the cache (miss). Below each: its cost with caching.',
			Scene: CacheScene,
		},
	],
	examples: [
		{ input: { arrivalMinutes: [0, 1, 2, 4, 8, 20, 21, 23], prefixTokens: 4500, dynamicTokens: 3150, outputTokens: 350 }, note: 'Busy, then a quiet gap' },
		{ input: { arrivalMinutes: [0, 6, 12, 18, 24], prefixTokens: 4500, dynamicTokens: 3150, outputTokens: 350 }, note: 'Too sparse: every request misses' },
		{ input: { arrivalMinutes: [0, 1, 2, 3], prefixTokens: 3000, dynamicTokens: 3150, outputTokens: 350 }, note: 'Prefix below the 4,096 minimum' },
	],
	fields: [
		{ name: 'minutes', label: 'arrival minutes', placeholder: 'e.g. 0 1 2 8 20' },
		{ name: 'prefix', label: 'cached prefix tokens', placeholder: 'e.g. 4500' },
		{ name: 'dynamic', label: 'other input tokens', placeholder: 'e.g. 3150' },
		{ name: 'output', label: 'output tokens', placeholder: 'e.g. 350' },
	],
	describe: ({ arrivalMinutes, prefixTokens }) => `minutes ${arrivalMinutes.join(' ')} · prefix ${tokens(prefixTokens)}`,
	parse(values) {
		const arrivalMinutes = parseMinutes(values.minutes ?? '');
		if (typeof arrivalMinutes === 'string') return { error: arrivalMinutes };
		const prefixTokens = parseTokens(values.prefix ?? '', 'cached prefix', 0, 100_000);
		if (typeof prefixTokens === 'string') return { error: prefixTokens };
		const dynamicTokens = parseTokens(values.dynamic ?? '', 'other input', 0, 200_000);
		if (typeof dynamicTokens === 'string') return { error: dynamicTokens };
		const outputTokens = parseTokens(values.output ?? '', 'output', 1, 64_000);
		if (typeof outputTokens === 'string') return { error: outputTokens };
		return { input: { arrivalMinutes, prefixTokens, dynamicTokens, outputTokens } };
	},
	steps: buildSteps,
});
