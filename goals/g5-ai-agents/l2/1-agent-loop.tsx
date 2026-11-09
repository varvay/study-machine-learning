import { Canvas, Cell, Frame, RowLabel, SubLabel, type CellTone } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

interface OrderItem {
	quantity: number;
	product: string;
}

interface LoopInput {
	items: OrderItem[];
	discountPercent: number;
}

type Role = 'user' | 'assistant';

interface TranscriptEntry {
	role: Role;
	content: string;
	stopReason?: 'tool_use' | 'end_turn';
	tone: CellTone;
}

interface LoopEvent {
	kind: 'call' | 'tools';
	entry: TranscriptEntry;
	narration: string;
}

interface LoopStep extends Step {
	visibleEntries: number;
	sentEntries: number;
}

type LoopSceneProps = SceneProps<LoopInput, LoopStep>;

const CATALOGUE_EUR: Record<string, number> = { keyboard: 49, monitor: 189, mouse: 25, headset: 79 };
const MAX_ITEMS = 4;
const CELL_TOP = 40;

const priceOf = (product: string): number | undefined => CATALOGUE_EUR[product];
const euro = (amount: number) => amount.toFixed(2);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const subtotalOf = (knownItems: OrderItem[]) => knownItems.reduce((sum, item) => sum + item.quantity * priceOf(item.product)!, 0);
const orderTotal = (knownItems: OrderItem[], discountPercent: number) => subtotalOf(knownItems) * (1 - discountPercent / 100);

function lookupResult(product: string) {
	const price = priceOf(product);
	if (price === undefined) return `lookup_price("${product}") → error "Unknown product '${product}'" (is_error: true)`;
	return `lookup_price("${product}") → ${price.toFixed(1)}`;
}

function buildEvents({ items, discountPercent }: LoopInput): LoopEvent[] {
	const knownItems = items.filter((item) => priceOf(item.product) !== undefined);
	const unknownProducts = items.filter((item) => priceOf(item.product) === undefined).map((item) => item.product);
	const lookups = items.length;
	const events: LoopEvent[] = [
		{
			kind: 'call',
			entry: { role: 'assistant', content: `lookup×${lookups}`, stopReason: 'tool_use', tone: 'focus' },
			narration: `The model reasons in its thinking, then acts: its reply holds ${plural(lookups, 'tool_use block')}, ${items.map((item) => `lookup_price("${item.product}")`).join(', ')}.${lookups > 1 ? ' They come in one reply because they do not depend on each other (parallel tool calls).' : ''} stop_reason is tool_use, so the loop runs the tools instead of returning.`,
		},
		{
			kind: 'tools',
			entry: { role: 'user', content: 'results', tone: unknownProducts.length > 0 ? 'remove' : 'add' },
			narration: `Your code runs each tool and sends every result back in one user message, each tool_result carrying the tool_use_id it answers: ${items.map((item) => lookupResult(item.product)).join('; ')}.${unknownProducts.length > 0 ? ' A failed tool goes back as a result with is_error: true, not as an exception, so the model can react to it.' : ''}`,
		},
	];
	if (knownItems.length === 0) {
		events.push({
			kind: 'call',
			entry: { role: 'assistant', content: 'answer', stopReason: 'end_turn', tone: 'add' },
			narration: `No product was found, so there is nothing to add up. The model answers that ${unknownProducts.join(' and ')} ${unknownProducts.length === 1 ? 'is' : 'are'} not in the catalogue. stop_reason is end_turn: the loop returns this text.`,
		});
		return events;
	}
	const total = orderTotal(knownItems, discountPercent);
	const lines = knownItems.map((item) => `${item.quantity} × ${priceOf(item.product)!.toFixed(1)}`).join(', ');
	events.push(
		{
			kind: 'call',
			entry: { role: 'assistant', content: 'total()', stopReason: 'tool_use', tone: 'focus' },
			narration: `The model observes the prices and acts again: order_total(lines = [${lines}], discount_percent = ${discountPercent}). It needed the prices first, so this call waited for the previous step.`,
		},
		{
			kind: 'tools',
			entry: { role: 'user', content: euro(total), tone: 'add' },
			narration: `order_total multiplies each line and adds them up: ${knownItems.map((item) => `${item.quantity} × ${priceOf(item.product)} = ${item.quantity * priceOf(item.product)!}`).join(', ')}${knownItems.length > 1 ? `, subtotal ${subtotalOf(knownItems)}` : ''}; ${discountPercent > 0 ? `total after ${discountPercent}% off = ${euro(total)}` : `no discount, so the total is ${euro(total)}`}. The result goes back as one tool_result.`,
		},
		{
			kind: 'call',
			entry: { role: 'assistant', content: 'answer', stopReason: 'end_turn', tone: 'add' },
			narration: `The model has what it needs and writes the answer: EUR ${euro(total)}${unknownProducts.length > 0 ? `, noting that ${unknownProducts.join(' and ')} could not be priced` : ''}. stop_reason is end_turn, so the loop returns the text.`,
		},
	);
	return events;
}

const questionEntry: TranscriptEntry = { role: 'user', content: 'question', tone: 'plain' };

function transcriptOf(input: LoopInput): TranscriptEntry[] {
	return [questionEntry, ...buildEvents(input).map((event) => event.entry)];
}

function describeOrder({ items, discountPercent }: LoopInput) {
	const order = items.map((item) => `${item.quantity} × ${item.product}`).join(' and ');
	return discountPercent > 0 ? `${order} with ${discountPercent}% off` : order;
}

function buildSteps(input: LoopInput): LoopStep[] {
	const events = buildEvents(input);
	let modelCalls = 0;
	let messagesSent = 0;
	let toolCalls = 0;
	const readout = () => ({ 'model calls': modelCalls, 'messages sent': messagesSent, 'tools run': toolCalls });

	const steps: LoopStep[] = [
		{
			visibleEntries: 1,
			sentEntries: 0,
			readout: readout(),
			narration: `The user asks for the price of ${describeOrder(input)}. The transcript, the messages list, starts with this one user message. Every request sends the whole list plus the two tool definitions, lookup_price and order_total.`,
		},
	];
	events.forEach((event, index) => {
		const visibleEntries = index + 2;
		if (event.kind === 'call') {
			modelCalls += 1;
			messagesSent += visibleEntries - 1;
			steps.push({
				visibleEntries,
				sentEntries: visibleEntries - 1,
				readout: readout(),
				narration: `<b>Model call ${modelCalls}</b> sends ${plural(visibleEntries - 1, 'message')}. ${event.narration}`,
			});
			return;
		}
		toolCalls += event.entry.content === 'results' ? input.items.length : 1;
		steps.push({ visibleEntries, sentEntries: 0, readout: readout(), narration: `<b>Tools run.</b> ${event.narration}` });
	});
	const perCall = steps.filter((step) => step.sentEntries > 0).map((step) => step.sentEntries);
	steps.push({
		visibleEntries: events.length + 1,
		sentEntries: 0,
		readout: readout(),
		narration: `Done in ${plural(modelCalls, 'model call')}, which sent ${perCall.join(' + ')} = ${messagesSent} messages in total. Each call resends the whole transcript, so input tokens grow with every step: the reason loops need step limits (G5.5) and long conversations need trimming (G5.2).`,
	});
	return steps;
}

function LoopScene({ input, step: { visibleEntries, sentEntries } }: LoopSceneProps) {
	const transcript = transcriptOf(input);
	return (
		<Canvas columns={transcript.length} height={CELL_TOP + 106}>
			<RowLabel top={CELL_TOP + 16}>role</RowLabel>
			<RowLabel top={CELL_TOP + 60}>content</RowLabel>
			<RowLabel top={CELL_TOP + 80}>stop_reason</RowLabel>
			{sentEntries > 0 && <Frame startColumn={0} columns={sentEntries} top={CELL_TOP - 8} label={`sent in this call: ${plural(sentEntries, 'message')}`} />}
			{transcript.map((entry, index) => {
				const hidden = index >= visibleEntries;
				const isNewest = index === visibleEntries - 1;
				return [
					<Cell key={`entry-${index}`} value={entry.role === 'user' ? 'U' : 'A'} column={index} top={CELL_TOP} tone={isNewest ? entry.tone : 'plain'} hidden={hidden} />,
					<SubLabel key={`content-${index}`} column={index} top={CELL_TOP + 62} hidden={hidden}>
						{entry.content}
					</SubLabel>,
					<SubLabel key={`stop-${index}`} column={index} top={CELL_TOP + 82} hidden={hidden || !entry.stopReason}>
						{entry.stopReason ?? ''}
					</SubLabel>,
				];
			})}
		</Canvas>
	);
}

function parseItems(raw: string): OrderItem[] | string {
	const parts = raw
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
	if (parts.length === 0 || parts.length > MAX_ITEMS) return `Enter 1 to ${MAX_ITEMS} items, e.g. 3 keyboard, 2 monitor.`;
	const items: OrderItem[] = [];
	for (const part of parts) {
		const match = /^(\d{1,2})\s+([a-z]{2,12})$/i.exec(part);
		if (!match) return `Write each item as a quantity and one product word, e.g. "3 keyboard"; "${part}" does not fit.`;
		const quantity = Number(match[1]);
		if (quantity < 1) return 'Quantities start at 1.';
		items.push({ quantity, product: match[2].toLowerCase() });
	}
	if (new Set(items.map((item) => item.product)).size !== items.length) return 'Name each product once; add up its quantity instead.';
	return items;
}

export default defineExplainer<LoopInput, LoopStep>({
	title: 'The agent loop, one message at a time',
	stages: [
		{
			title: 'Reason, act, observe',
			subtitle: 'Each cell is one message in the transcript: U = user, A = assistant. The frame marks what one model call sends. Catalogue: keyboard 49, monitor 189, mouse 25, headset 79 (EUR); anything else is unknown. The model replies are simulated.',
			Scene: LoopScene,
		},
	],
	examples: [
		{ input: { items: [{ quantity: 3, product: 'keyboard' }, { quantity: 2, product: 'monitor' }], discountPercent: 20 }, note: 'Two lookups in parallel' },
		{ input: { items: [{ quantity: 2, product: 'keyboard' }, { quantity: 1, product: 'webcam' }], discountPercent: 10 }, note: 'A tool returns an error' },
		{ input: { items: [{ quantity: 4, product: 'mouse' }], discountPercent: 0 }, note: 'One product, no discount' },
	],
	fields: [
		{ name: 'items', label: 'order', placeholder: 'e.g. 3 keyboard, 2 monitor' },
		{ name: 'discount', label: 'discount %', placeholder: '0 to 100' },
	],
	describe: (input) => describeOrder(input),
	parse(values) {
		const items = parseItems(values.items);
		if (typeof items === 'string') return { error: items };
		const discountPercent = values.discount.trim() === '' ? 0 : Number(values.discount);
		if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) return { error: 'The discount is a number from 0 to 100; leave it blank for none.' };
		return { input: { items, discountPercent } };
	},
	steps: buildSteps,
});
