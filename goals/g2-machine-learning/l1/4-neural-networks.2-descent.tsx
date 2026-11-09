import { Dot, Link, Plane, PlotCanvas, Ring, type PlotPosition } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

interface DescentInput {
	learningRate: number;
	start: number;
}

interface DescentStep extends Step {
	visited: number[];
}

type DescentSceneProps = SceneProps<DescentInput, DescentStep>;

const UPDATES = 8;
const BEST_W = 3;
const MIN_LOSS = 1;
const W_MIN = -1;
const W_MAX = 7;
const LOSS_MAX = 17;

const loss = (w: number) => (w - BEST_W) ** 2 + MIN_LOSS;
const gradient = (w: number) => 2 * (w - BEST_W);

const format = (value: number) => (Math.abs(value) >= 1000 ? value.toExponential(1) : value.toFixed(2));
const onChart = (w: number) => w >= W_MIN && w <= W_MAX;

function descend({ learningRate, start }: DescentInput) {
	const visited = [start];
	for (let update = 0; update < UPDATES; update++) {
		const w = visited.at(-1)!;
		visited.push(w - learningRate * gradient(w));
	}
	return visited;
}

function updateNarration(update: number, w: number, next: number, learningRate: number) {
	const slope = gradient(w);
	const direction = slope < 0 ? 'the loss falls as w grows' : slope > 0 ? 'the loss rises as w grows' : 'the curve is flat here';
	const leftChart = onChart(next) ? '' : ' That lands off the chart.';
	const slopeTerm = slope < 0 ? `(${format(slope)})` : format(slope);
	return `Update ${update}: at w = ${format(w)}, the gradient (the slope) is ${format(slope)}, so ${direction}. Step against it: w ← ${format(w)} − ${learningRate} × ${slopeTerm} = ${format(next)}. Loss ${format(loss(w))} → ${format(loss(next))}.${leftChart}`;
}

function verdictNarration(visited: number[], learningRate: number) {
	const distances = visited.map((w) => Math.abs(w - BEST_W));
	const final = distances.at(-1)!;
	const zigzags = visited.slice(1).some((w, index) => Math.sign(w - BEST_W) !== Math.sign(visited[index] - BEST_W));
	if (final > distances[0]) return ` Each step overshoots further than the last: with learning rate ${learningRate}, training <b>diverges</b>, and the loss grows without limit.`;
	if (final < 0.05) return zigzags ? ` It overshot back and forth but still settled at the minimum, w = ${BEST_W}.` : ` It reached the minimum, w = ${BEST_W}, in a few steps.`;
	if (zigzags)
		return ` Every step jumps past the minimum to the other side. It closes in, but after ${UPDATES} updates it is still ${format(final)} away: learning rate ${learningRate} is large enough to <b>overshoot</b> on every step.`;
	return ` After ${UPDATES} updates it is still ${format(final)} away from the minimum: learning rate ${learningRate} is too small, so training <b>crawls</b>.`;
}

function buildSteps(input: DescentInput): DescentStep[] {
	const visited = descend(input);
	const readoutAt = (index: number) => ({ update: index, w: format(visited[index]), loss: format(loss(visited[index])), gradient: format(gradient(visited[index])) });
	const steps: DescentStep[] = [
		{
			visited: visited.slice(0, 1),
			readout: readoutAt(0),
			narration: `The curve shows the loss for every value of one parameter, w. The lowest loss is at w = ${BEST_W}, but training cannot see the curve: it knows only the slope where it stands. It starts at w = ${format(input.start)} with learning rate η = ${input.learningRate}.`,
		},
	];
	for (let update = 1; update <= UPDATES; update++) {
		const isLast = update === UPDATES;
		steps.push({
			visited: visited.slice(0, update + 1),
			readout: readoutAt(update),
			narration: updateNarration(update, visited[update - 1], visited[update], input.learningRate) + (isLast ? verdictNarration(visited, input.learningRate) : ''),
		});
	}
	return steps;
}

const PLOT_WIDTH = 600;
const PLOT_HEIGHT = 300;
const PLOT_TOP = 24;
const PLOT_PADDING = 18;
const CURVE_SEGMENTS = 80;
const TANGENT_HALF_WIDTH = 0.9;

const toPlot = (w: number, value: number): PlotPosition => ({
	x: PLOT_PADDING + ((Math.max(W_MIN, Math.min(W_MAX, w)) - W_MIN) / (W_MAX - W_MIN)) * (PLOT_WIDTH - 2 * PLOT_PADDING),
	y: PLOT_TOP + PLOT_PADDING + (1 - Math.min(LOSS_MAX, value) / LOSS_MAX) * (PLOT_HEIGHT - 2 * PLOT_PADDING),
});

const pointOnCurve = (w: number) => toPlot(w, loss(w));

function DescentScene({ step: { visited } }: DescentSceneProps) {
	const current = visited.at(-1)!;
	const curve = Array.from({ length: CURVE_SEGMENTS + 1 }, (_, index) => W_MIN + (index / CURVE_SEGMENTS) * (W_MAX - W_MIN));
	const tangentStart = current - TANGENT_HALF_WIDTH;
	const tangentEnd = current + TANGENT_HALF_WIDTH;
	const tangentAt = (w: number) => toPlot(w, loss(current) + gradient(current) * (w - current));

	return (
		<PlotCanvas width={PLOT_WIDTH} height={PLOT_TOP + PLOT_HEIGHT + 4}>
			<Plane left={0} top={PLOT_TOP} width={PLOT_WIDTH} height={PLOT_HEIGHT} label={`loss = (w − ${BEST_W})² + ${MIN_LOSS}, for w from ${W_MIN} to ${W_MAX}`} />
			{curve.slice(1).map((w, index) => (
				<Link key={`curve-${index}`} from={pointOnCurve(curve[index])} to={pointOnCurve(w)} />
			))}
			{visited.slice(1).map((w, index) => (
				<Link key={`step-${index}`} from={pointOnCurve(visited[index])} to={pointOnCurve(w)} tone="add" hidden={!onChart(w) && !onChart(visited[index])} />
			))}
			{visited.map((w, index) => (
				<Dot key={`visit-${index}`} position={pointOnCurve(w)} tone="focus" hidden={!onChart(w)} />
			))}
			<Link key="tangent" from={tangentAt(tangentStart)} to={tangentAt(tangentEnd)} tone="remove" hidden={!onChart(current)} />
			<Dot key="minimum" position={pointOnCurve(BEST_W)} tone="add" />
			<Ring position={pointOnCurve(current)} hidden={!onChart(current)} />
		</PlotCanvas>
	);
}

export default defineExplainer<DescentInput, DescentStep>({
	title: 'Gradient descent: the learning rate decides',
	stages: [
		{
			title: 'Walking down the loss curve',
			subtitle: 'The ring is the current w; the dashed red line is the slope there, the gradient. Green lines are the steps taken so far; the green dot marks the minimum.',
			Scene: DescentScene,
		},
	],
	examples: [
		{ input: { learningRate: 0.05, start: 0 }, note: 'Too small: crawls' },
		{ input: { learningRate: 0.3, start: 0 }, note: 'About right' },
		{ input: { learningRate: 0.9, start: 0 }, note: 'Large: zigzags' },
		{ input: { learningRate: 1.05, start: 0 }, note: 'Too large: diverges' },
	],
	fields: [
		{ name: 'rate', label: 'learning rate η', placeholder: 'e.g. 0.3' },
		{ name: 'start', label: 'start w', placeholder: `${W_MIN} to ${W_MAX}` },
	],
	describe: ({ learningRate, start }) => `η = ${learningRate}, start w = ${start}`,
	parse(values) {
		const learningRate = Number(values.rate);
		if (values.rate === '' || !Number.isFinite(learningRate) || learningRate <= 0 || learningRate > 2) return { error: 'Use a learning rate above 0 and at most 2.' };
		const start = values.start === '' ? 0 : Number(values.start);
		if (!Number.isFinite(start) || start < W_MIN || start > W_MAX) return { error: `Start w must lie between ${W_MIN} and ${W_MAX}.` };
		return { input: { learningRate, start } };
	},
	steps: buildSteps,
});
