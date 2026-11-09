import { Dot, Link, Plane, PlotCanvas, Ring, type PlotPosition } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

interface ScheduleInput {
	peakRate: number;
	totalSteps: number;
	warmupSteps: number;
	floorPercent: number;
}

type Phase = 'warmup' | 'peak' | 'decay' | 'end';

interface Checkpoint {
	trainingStep: number;
	phase: Phase;
}

interface ScheduleStep extends Step {
	visited: number[];
}

type ScheduleSceneProps = SceneProps<ScheduleInput, ScheduleStep>;

const MIN_TOTAL_STEPS = 10;
const MAX_TOTAL_STEPS = 1_000_000;
const DECAY_FRACTIONS = [0.25, 0.5, 0.75];
const HALFWAY_TOLERANCE = 0.01;

const floorRate = ({ peakRate, floorPercent }: ScheduleInput) => (peakRate * floorPercent) / 100;
const decayProgress = ({ totalSteps, warmupSteps }: ScheduleInput, trainingStep: number) => (trainingStep - warmupSteps) / (totalSteps - warmupSteps);

function learningRateAt(input: ScheduleInput, trainingStep: number) {
	if (trainingStep < input.warmupSteps) return (input.peakRate * trainingStep) / input.warmupSteps;
	const floor = floorRate(input);
	return floor + (input.peakRate - floor) * 0.5 * (1 + Math.cos(Math.PI * decayProgress(input, trainingStep)));
}

function checkpointsOf({ totalSteps, warmupSteps }: ScheduleInput): Checkpoint[] {
	const warmup: Checkpoint[] = warmupSteps > 0 ? [{ trainingStep: 0, phase: 'warmup' }, { trainingStep: Math.round(warmupSteps / 2), phase: 'warmup' }] : [];
	const decay = DECAY_FRACTIONS.map((fraction): Checkpoint => ({ trainingStep: Math.round(warmupSteps + fraction * (totalSteps - warmupSteps)), phase: 'decay' }));
	const all = [...warmup, { trainingStep: warmupSteps, phase: 'peak' as const }, ...decay, { trainingStep: totalSteps, phase: 'end' as const }];
	return all.filter((checkpoint, index) => index === all.length - 1 || checkpoint.trainingStep !== all[index + 1].trainingStep);
}

const formatRate = (rate: number) => {
	if (rate === 0) return '0';
	const [mantissa, exponent] = rate.toExponential(2).split('e');
	return `${Number(mantissa)}e${Number(exponent)}`;
};

const percent = (part: number, whole: number) => `${Math.round((100 * part) / whole)}%`;

function warmupNarration(input: ScheduleInput, trainingStep: number) {
	const rate = learningRateAt(input, trainingStep);
	if (trainingStep === 0)
		return `Step 0: the learning rate starts at 0. The weights are random, the first gradients are large and erratic, and Adam's running estimate of each gradient's size rests on almost no data yet. A full-size step now could throw the weights somewhere training never recovers from. Warmup raises the rate linearly over the first ${input.warmupSteps} steps, ${percent(input.warmupSteps, input.totalSteps)} of training.`;
	return `Step ${trainingStep}: halfway through warmup. lr = peak × step / warmup = ${formatRate(input.peakRate)} × ${trainingStep} / ${input.warmupSteps} = ${formatRate(rate)}. Each step is bigger than the last while the optimizer's estimates settle.`;
}

function peakNarration(input: ScheduleInput) {
	const start = input.warmupSteps === 0 ? `Step 0: with no warmup, training starts at the peak rate, ${formatRate(input.peakRate)}.` : `Step ${input.warmupSteps}: warmup ends at the peak rate, ${formatRate(input.peakRate)}.`;
	return `${start} Cosine decay takes over: lr = floor + (peak − floor) × ½(1 + cos(π × progress)), where progress runs from 0 now to 1 at step ${input.totalSteps}, and the floor is ${formatRate(floorRate(input))}.`;
}

function decayNarration(input: ScheduleInput, trainingStep: number) {
	const progress = decayProgress(input, trainingStep);
	const share = 0.5 * (1 + Math.cos(Math.PI * progress));
	const meaning =
		Math.abs(progress - 0.5) < HALFWAY_TOLERANCE
			? 'Halfway through the decay, the rate is halfway between peak and floor, and falling at its fastest.'
			: progress < 0.5
				? 'The cosine falls slowly at first, so the rate stays high while the loss still has far to fall.'
				: 'The fall slows again as the rate nears the floor; the smaller steps now refine instead of explore.';
	return `Step ${trainingStep}, progress ${progress.toFixed(2)}: ½(1 + cos(π × ${progress.toFixed(2)})) = ${share.toFixed(3)}, so lr = ${formatRate(learningRateAt(input, trainingStep))}, ${Math.round(share * 100)}% of the way from floor to peak. ${meaning}`;
}

function endNarration(input: ScheduleInput) {
	return `Step ${input.totalSteps}: the rate reaches the floor, ${formatRate(floorRate(input))}. Tiny final steps let the weights settle into the bottom of a minimum instead of bouncing across it (the zigzag of G2.4 L1). The schedule is tied to ${input.totalSteps} total steps: stop early and the rate never got low; train longer and the rate sits at the floor.`;
}

function narrationFor(input: ScheduleInput, { trainingStep, phase }: Checkpoint) {
	if (phase === 'warmup') return warmupNarration(input, trainingStep);
	if (phase === 'peak') return peakNarration(input);
	if (phase === 'decay') return decayNarration(input, trainingStep);
	return endNarration(input);
}

function buildSteps(input: ScheduleInput): ScheduleStep[] {
	const checkpoints = checkpointsOf(input);
	return checkpoints.map((checkpoint, index) => ({
		visited: checkpoints.slice(0, index + 1).map(({ trainingStep }) => trainingStep),
		readout: { step: checkpoint.trainingStep, 'learning rate': formatRate(learningRateAt(input, checkpoint.trainingStep)), phase: checkpoint.phase },
		narration: narrationFor(input, checkpoint),
	}));
}

const PLOT_WIDTH = 600;
const PLOT_HEIGHT = 300;
const PLOT_TOP = 24;
const PLOT_PADDING = 18;
const CURVE_SEGMENTS = 120;

const toPlot = (input: ScheduleInput, trainingStep: number): PlotPosition => ({
	x: PLOT_PADDING + (trainingStep / input.totalSteps) * (PLOT_WIDTH - 2 * PLOT_PADDING),
	y: PLOT_TOP + PLOT_PADDING + (1 - learningRateAt(input, trainingStep) / input.peakRate) * (PLOT_HEIGHT - 2 * PLOT_PADDING),
});

function ScheduleScene({ input, step: { visited } }: ScheduleSceneProps) {
	const curveSteps = Array.from({ length: CURVE_SEGMENTS + 1 }, (_, index) => (index / CURVE_SEGMENTS) * input.totalSteps);
	const withWarmupCorner = input.warmupSteps > 0 ? [...curveSteps.filter((trainingStep) => trainingStep < input.warmupSteps), input.warmupSteps, ...curveSteps.filter((trainingStep) => trainingStep > input.warmupSteps)] : curveSteps;
	const current = visited.at(-1)!;

	return (
		<PlotCanvas width={PLOT_WIDTH} height={PLOT_TOP + PLOT_HEIGHT + 4}>
			<Plane left={0} top={PLOT_TOP} width={PLOT_WIDTH} height={PLOT_HEIGHT} label={`learning rate from 0 to ${formatRate(input.peakRate)}, over steps 0 to ${input.totalSteps}`} />
			{withWarmupCorner.slice(1).map((trainingStep, index) => (
				<Link key={`curve-${index}`} from={toPlot(input, withWarmupCorner[index])} to={toPlot(input, trainingStep)} tone={trainingStep <= current ? 'focus' : 'plain'} />
			))}
			{visited.map((trainingStep) => (
				<Dot key={`checkpoint-${trainingStep}`} position={toPlot(input, trainingStep)} tone="focus" />
			))}
			<Ring position={toPlot(input, current)} label={`step ${current}`} />
		</PlotCanvas>
	);
}

export default defineExplainer<ScheduleInput, ScheduleStep>({
	title: 'Learning rate: warmup, then cosine decay',
	stages: [
		{
			title: 'The learning rate over one training run',
			subtitle: 'The ring marks the current step; the coloured part of the curve is the schedule so far.',
			Scene: ScheduleScene,
		},
	],
	examples: [
		{ input: { peakRate: 0.0002, totalSteps: 1000, warmupSteps: 30, floorPercent: 0 }, note: 'Fine-tune: 3% warmup, decay to 0' },
		{ input: { peakRate: 0.0003, totalSteps: 10000, warmupSteps: 1000, floorPercent: 10 }, note: '10% warmup, floor at 10% of peak' },
		{ input: { peakRate: 0.001, totalSteps: 500, warmupSteps: 0, floorPercent: 0 }, note: 'No warmup' },
	],
	fields: [
		{ name: 'peak', label: 'peak rate', placeholder: 'e.g. 2e-4' },
		{ name: 'total', label: 'total steps', placeholder: `${MIN_TOTAL_STEPS} to ${MAX_TOTAL_STEPS}` },
		{ name: 'warmup', label: 'warmup steps', placeholder: 'fewer than total' },
		{ name: 'floor', label: 'floor, % of peak', placeholder: '0 to 100' },
	],
	describe: ({ peakRate, totalSteps, warmupSteps, floorPercent }) => `peak ${formatRate(peakRate)}, ${totalSteps} steps, ${warmupSteps} warmup, floor ${floorPercent}%`,
	parse(values) {
		const peakRate = Number(values.peak);
		if (values.peak === '' || !Number.isFinite(peakRate) || peakRate <= 0 || peakRate > 1) return { error: 'Use a peak rate above 0 and at most 1, such as 2e-4.' };
		const totalSteps = Number(values.total);
		if (values.total === '' || !Number.isInteger(totalSteps) || totalSteps < MIN_TOTAL_STEPS || totalSteps > MAX_TOTAL_STEPS)
			return { error: `Use a whole number of total steps from ${MIN_TOTAL_STEPS} to ${MAX_TOTAL_STEPS}.` };
		const warmupSteps = values.warmup === '' ? 0 : Number(values.warmup);
		if (!Number.isInteger(warmupSteps) || warmupSteps < 0 || warmupSteps >= totalSteps) return { error: 'Warmup steps must be a whole number from 0 to one less than the total.' };
		const floorPercent = values.floor === '' ? 0 : Number(values.floor);
		if (!Number.isFinite(floorPercent) || floorPercent < 0 || floorPercent > 100) return { error: 'The floor is a percentage of the peak, from 0 to 100.' };
		return { input: { peakRate, totalSteps, warmupSteps, floorPercent } };
	},
	steps: buildSteps,
});
