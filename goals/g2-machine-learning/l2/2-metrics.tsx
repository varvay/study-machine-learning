import { Dot, Link, Plane, PlotCanvas, Ring, type PlotPosition } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

interface ScoredCase {
	score: number;
	positive: boolean;
}

interface CurveInput {
	positiveScores: number[];
	negativeScores: number[];
	targetRecall: number;
}

interface CurvePoint {
	threshold: number;
	truePositives: number;
	falsePositives: number;
	precision: number;
	recall: number;
}

interface CurveStep extends Step {
	traced: number;
	chosen?: number;
}

type CurveSceneProps = SceneProps<CurveInput, CurveStep>;

const MAX_CASES = 12;

const casesOf = ({ positiveScores, negativeScores }: CurveInput): ScoredCase[] => [
	...positiveScores.map((score) => ({ score, positive: true })),
	...negativeScores.map((score) => ({ score, positive: false })),
];

function tracePoints(input: CurveInput): CurvePoint[] {
	const cases = casesOf(input);
	const positiveCount = input.positiveScores.length;
	const thresholds = [...new Set(cases.map((each) => each.score))].sort((a, b) => b - a);
	return thresholds.map((threshold) => {
		const called = cases.filter((each) => each.score >= threshold);
		const truePositives = called.filter((each) => each.positive).length;
		const falsePositives = called.length - truePositives;
		return { threshold, truePositives, falsePositives, precision: truePositives / called.length, recall: truePositives / positiveCount };
	});
}

function chooseThreshold(points: CurvePoint[], targetRecall: number): number {
	return points.reduce((best, point, index) => {
		if (point.recall < targetRecall) return best;
		if (best === -1 || point.precision > points[best].precision) return index;
		return best;
	}, -1);
}

const two = (value: number) => value.toFixed(2);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function joinedNarration(point: CurvePoint, previous?: CurvePoint) {
	const newTruePositives = point.truePositives - (previous?.truePositives ?? 0);
	const newFalsePositives = point.falsePositives - (previous?.falsePositives ?? 0);
	if (!previous) {
		if (newTruePositives + newFalsePositives > 1) return `They tie on the top score: ${plural(newTruePositives, 'true positive')} and ${plural(newFalsePositives, 'false alarm')}.`;
		return newFalsePositives === 0 ? 'The first case called positive is a true positive.' : 'The first case called positive is a false alarm.';
	}
	if (newFalsePositives === 0) return `${plural(newTruePositives, 'true positive')} joined: recall rises and precision rises or holds, so the curve moves right.`;
	if (newTruePositives === 0) return `${plural(newFalsePositives, 'false alarm')} joined: recall holds and precision falls, so the curve drops straight down.`;
	return `${plural(newTruePositives, 'true positive')} and ${plural(newFalsePositives, 'false alarm')} joined: recall rises, and precision moves toward the share of true positives among the newcomers.`;
}

function pointNarration(point: CurvePoint, positiveCount: number, previous?: CurvePoint) {
	const called = point.truePositives + point.falsePositives;
	const calledClause = called === 1 ? '1 case scores at least that and is called positive' : `${called} cases score at least that and are called positive`;
	return `Threshold ${two(point.threshold)}: ${calledClause}. ${joinedNarration(point, previous)} Precision ${point.truePositives}/${called} = ${two(point.precision)}; recall ${point.truePositives}/${positiveCount} = ${two(point.recall)}.`;
}

function choiceNarration(points: CurvePoint[], chosen: number, targetRecall: number) {
	const point = points[chosen];
	const meeting = points.filter((each) => each.recall >= targetRecall).length;
	const meetingClause = meeting === 1 ? '1 point sits' : `${meeting} points sit`;
	return `The need: recall at least ${two(targetRecall)}. ${meetingClause} on or right of the dashed line; the one with the highest precision is threshold <b>${two(point.threshold)}</b>, with precision ${two(point.precision)} and recall ${two(point.recall)}. Pick it on validation data, then report the test-set score once.`;
}

function buildSteps(input: CurveInput): CurveStep[] {
	const points = tracePoints(input);
	const positiveCount = input.positiveScores.length;
	const chosen = chooseThreshold(points, input.targetRecall);
	const readoutAt = (index?: number) => {
		if (index === undefined) return { threshold: '–', TP: '–', FP: '–', precision: '–', recall: '–' };
		const point = points[index];
		return { threshold: two(point.threshold), TP: point.truePositives, FP: point.falsePositives, precision: two(point.precision), recall: two(point.recall) };
	};
	const steps: CurveStep[] = [
		{
			traced: 0,
			readout: readoutAt(),
			narration: `${plural(positiveCount + input.negativeScores.length, 'case')}, each with the model's score from 0 to 1; ${positiveCount} are truly positive. Each threshold turns the scores into decisions and gives one point: recall across, precision up. The threshold starts at the highest score and moves down.`,
		},
	];
	points.forEach((point, index) => {
		steps.push({ traced: index + 1, readout: readoutAt(index), narration: pointNarration(point, positiveCount, points[index - 1]) });
	});
	steps.push({ traced: points.length, chosen, readout: readoutAt(chosen), narration: choiceNarration(points, chosen, input.targetRecall) });
	return steps;
}

const PLOT_WIDTH = 600;
const CURVE_TOP = 24;
const CURVE_HEIGHT = 280;
const STRIP_TOP = CURVE_TOP + CURVE_HEIGHT + 46;
const STRIP_HEIGHT = 56;
const PADDING = 22;

const onCurve = (recall: number, precision: number): PlotPosition => ({
	x: PADDING + recall * (PLOT_WIDTH - 2 * PADDING),
	y: CURVE_TOP + PADDING + (1 - precision) * (CURVE_HEIGHT - 2 * PADDING),
});

const onStrip = (score: number, positive: boolean): PlotPosition => ({
	x: PADDING + score * (PLOT_WIDTH - 2 * PADDING),
	y: STRIP_TOP + (positive ? 18 : 38),
});

function CurveScene({ input, step: { traced, chosen } }: CurveSceneProps) {
	const points = tracePoints(input);
	const shown = points.slice(0, traced);
	const current = chosen ?? traced - 1;
	const threshold = current >= 0 ? points[current].threshold : undefined;
	const thresholdX = onStrip(threshold ?? 1, true).x;

	return (
		<PlotCanvas width={PLOT_WIDTH} height={STRIP_TOP + STRIP_HEIGHT + 4}>
			<Plane left={0} top={CURVE_TOP} width={PLOT_WIDTH} height={CURVE_HEIGHT} label="precision (up, 0 to 1) against recall (across, 0 to 1)" active={traced > 0} />
			<Link
				key="target"
				from={onCurve(input.targetRecall, 0)}
				to={onCurve(input.targetRecall, 1)}
				tone="remove"
				hidden={chosen === undefined}
			/>
			{points.slice(1).map((point, index) => (
				<Link
					key={`segment-${index}`}
					from={onCurve(points[index].recall, points[index].precision)}
					to={onCurve(point.recall, point.precision)}
					tone="focus"
					hidden={index + 2 > traced}
				/>
			))}
			{points.map((point, index) => (
				<Dot
					key={`point-${index}`}
					position={onCurve(point.recall, point.precision)}
					tone={index === chosen ? 'add' : 'focus'}
					label={index === chosen ? `threshold ${two(point.threshold)}` : undefined}
					hidden={index >= shown.length}
				/>
			))}
			<Ring position={current >= 0 ? onCurve(points[current].recall, points[current].precision) : onCurve(0, 1)} hidden={current < 0} />
			<Plane left={0} top={STRIP_TOP} width={PLOT_WIDTH} height={STRIP_HEIGHT} label="scores, 0 to 1 · top row truly positive, bottom row negative · solid = called positive" />
			<Link key="threshold" from={{ x: thresholdX, y: STRIP_TOP + 4 }} to={{ x: thresholdX, y: STRIP_TOP + STRIP_HEIGHT - 4 }} tone="remove" hidden={threshold === undefined} />
			{casesOf(input).map((each, index) => (
				<Dot
					key={`case-${index}`}
					position={onStrip(each.score, each.positive)}
					tone={each.positive ? 'add' : 'plain'}
					ghost={threshold === undefined || each.score < threshold}
				/>
			))}
		</PlotCanvas>
	);
}

function parseScores(raw: string, label: string): number[] | string {
	const scores = raw
		.split(/[\s,]+/)
		.filter(Boolean)
		.map(Number);
	if (scores.length === 0) return `Enter at least one ${label} score.`;
	if (scores.some((score) => !Number.isFinite(score) || score < 0 || score > 1)) return 'Scores are numbers from 0 to 1, such as 0.85.';
	return scores;
}

export default defineExplainer<CurveInput, CurveStep>({
	title: 'Trace the precision-recall curve, then pick a threshold',
	stages: [
		{
			title: 'One point per threshold',
			subtitle: 'Top: the precision-recall curve so far; the ring is the current threshold. Bottom: every case by score, with the threshold as a dashed line.',
			Scene: CurveScene,
		},
	],
	examples: [
		{ input: { positiveScores: [0.95, 0.88, 0.81, 0.62, 0.4], negativeScores: [0.7, 0.35, 0.22, 0.15, 0.05], targetRecall: 0.8 }, note: 'Recall ≥ 0.80' },
		{ input: { positiveScores: [0.93, 0.85, 0.78, 0.66, 0.18], negativeScores: [0.72, 0.55, 0.47, 0.3, 0.1], targetRecall: 1 }, note: 'Catch every case' },
		{ input: { positiveScores: [0.8, 0.55, 0.45, 0.3, 0.2], negativeScores: [0.9, 0.7, 0.6, 0.35, 0.1], targetRecall: 0.6 }, note: 'A weak model' },
	],
	fields: [
		{ name: 'positive', label: 'positive scores', placeholder: 'e.g. 0.95 0.81 0.4' },
		{ name: 'negative', label: 'negative scores', placeholder: 'e.g. 0.7 0.22 0.05' },
		{ name: 'target', label: 'target recall', placeholder: '0 to 1, e.g. 0.8' },
	],
	describe: ({ positiveScores, negativeScores, targetRecall }) => `positive ${positiveScores.join(' ')} · negative ${negativeScores.join(' ')} · recall ≥ ${targetRecall}`,
	parse(values) {
		const positiveScores = parseScores(values.positive, 'positive');
		if (typeof positiveScores === 'string') return { error: positiveScores };
		const negativeScores = parseScores(values.negative, 'negative');
		if (typeof negativeScores === 'string') return { error: negativeScores };
		if (positiveScores.length + negativeScores.length > MAX_CASES) return { error: `Use ${MAX_CASES} cases or fewer in total.` };
		const targetRecall = Number(values.target);
		if (values.target === '' || !Number.isFinite(targetRecall) || targetRecall <= 0 || targetRecall > 1) return { error: 'Target recall is a number above 0 and at most 1.' };
		return { input: { positiveScores, negativeScores, targetRecall } };
	},
	steps: buildSteps,
});
