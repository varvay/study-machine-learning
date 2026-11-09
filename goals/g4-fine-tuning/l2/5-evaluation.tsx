import { Dot, Link, Plane, PlotCanvas, Ring, type LinkTone, type PlotPosition } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

interface LossCurveInput {
	trainingExamples: number;
	epochs: number;
}

interface LossCurveStep extends Step {
	evaluationsShown: number;
}

type LossCurveSceneProps = SceneProps<LossCurveInput, LossCurveStep>;

interface Evaluation {
	epoch: number;
	trainLoss: number;
	evalLoss: number;
}

const EVALUATIONS_PER_EPOCH = 2;
const MIN_EXAMPLES = 50;
const MAX_EXAMPLES = 20000;
const MAX_EPOCHS = 8;
const LOSS_MAX = 2.2;

const TRAIN_FLOOR = 0.15;
const TRAIN_DROP = 1.75;
const TRAIN_DECAY = 1.0;
const EVAL_FLOOR = 0.45;
const EVAL_DROP = 1.45;
const EVAL_DECAY = 1.2;
const OVERFIT_GROWTH = 0.12;
const OVERFIT_POWER = 1.2;
const REFERENCE_EXAMPLES = 200;

const format = (value: number) => value.toFixed(2);
const formatEpoch = (epoch: number) => (Number.isInteger(epoch) ? String(epoch) : epoch.toFixed(1));

const overfitOnset = (trainingExamples: number) => Math.min(MAX_EPOCHS, Math.max(0.5, 0.5 + 1.25 * Math.log2(trainingExamples / REFERENCE_EXAMPLES)));
const trainLossAt = (epoch: number) => TRAIN_FLOOR + TRAIN_DROP * Math.exp(-TRAIN_DECAY * epoch);
const evalLossAt = (epoch: number, onset: number) => EVAL_FLOOR + EVAL_DROP * Math.exp(-EVAL_DECAY * epoch) + OVERFIT_GROWTH * Math.max(0, epoch - onset) ** OVERFIT_POWER;

function evaluationsOf({ trainingExamples, epochs }: LossCurveInput): Evaluation[] {
	const onset = overfitOnset(trainingExamples);
	return Array.from({ length: epochs * EVALUATIONS_PER_EPOCH + 1 }, (_, index) => {
		const epoch = index / EVALUATIONS_PER_EPOCH;
		return { epoch, trainLoss: trainLossAt(epoch), evalLoss: evalLossAt(epoch, onset) };
	});
}

const bestIndexAmong = (evaluations: Evaluation[]) => evaluations.reduce((best, evaluation, index) => (evaluation.evalLoss < evaluations[best].evalLoss ? index : best), 0);

function progressNarration(evaluations: Evaluation[], index: number, trainingExamples: number) {
	const previous = evaluations[index - 1];
	const current = evaluations[index];
	const change = `Epoch ${formatEpoch(current.epoch)}: train loss ${format(previous.trainLoss)} → ${format(current.trainLoss)}, eval loss ${format(previous.evalLoss)} → ${format(current.evalLoss)}.`;
	const isNewBest = bestIndexAmong(evaluations.slice(0, index + 1)) === index;
	if (isNewBest) return `${change} Eval loss is the lowest so far, so this checkpoint is now the best one.`;
	const evalRose = current.evalLoss > previous.evalLoss;
	const roseBefore = evaluations.slice(1, index).some((evaluation, offset) => evaluation.evalLoss > evaluations[offset].evalLoss);
	if (evalRose && !roseBefore)
		return `${change} Eval loss rose while train loss kept falling: the model now fits its ${trainingExamples} training examples better than unseen ones. This is where <b>overfitting</b> begins.`;
	if (evalRose) return `${change} Eval loss keeps rising: each further step memorizes the training set a little more.`;
	return `${change} Eval loss fell, but not below the best checkpoint.`;
}

function verdictNarration(evaluations: Evaluation[]) {
	const last = evaluations.at(-1)!;
	const bestIndex = bestIndexAmong(evaluations);
	const best = evaluations[bestIndex];
	if (bestIndex === evaluations.length - 1)
		return ` Training ends at epoch ${formatEpoch(last.epoch)} with eval loss still at its lowest, ${format(best.evalLoss)}: the model may still be improving, so more epochs or more data could help.`;
	return ` Training ends at epoch ${formatEpoch(last.epoch)}. The lowest eval loss, ${format(best.evalLoss)}, came at epoch ${formatEpoch(best.epoch)}; the last checkpoint scores ${format(last.evalLoss)}. With <code>load_best_model_at_end=True</code> and <code>metric_for_best_model="eval_loss"</code>, the trainer reloads the epoch ${formatEpoch(best.epoch)} checkpoint.`;
}

function buildSteps(input: LossCurveInput): LossCurveStep[] {
	const evaluations = evaluationsOf(input);
	const readoutAt = (index: number) => {
		const bestSoFar = evaluations[bestIndexAmong(evaluations.slice(0, index + 1))];
		return {
			epoch: formatEpoch(evaluations[index].epoch),
			'train loss': format(evaluations[index].trainLoss),
			'eval loss': format(evaluations[index].evalLoss),
			'best epoch': formatEpoch(bestSoFar.epoch),
		};
	};
	const first = evaluations[0];
	const steps: LossCurveStep[] = [
		{
			evaluationsShown: 1,
			readout: readoutAt(0),
			narration: `Before training: train loss ${format(first.trainLoss)}, eval loss ${format(first.evalLoss)}. The model trains on ${input.trainingExamples} examples for ${input.epochs} epochs and is scored on the held-out validation set every half epoch. The curves come from a toy model in which a smaller dataset starts to overfit sooner.`,
		},
	];
	for (let index = 1; index < evaluations.length; index++) {
		const isLast = index === evaluations.length - 1;
		steps.push({
			evaluationsShown: index + 1,
			readout: readoutAt(index),
			narration: progressNarration(evaluations, index, input.trainingExamples) + (isLast ? verdictNarration(evaluations) : ''),
		});
	}
	return steps;
}

const PLOT_WIDTH = 600;
const PLOT_HEIGHT = 300;
const PLOT_TOP = 24;
const PLOT_PADDING = 18;

function LossCurveScene({ input, step: { evaluationsShown } }: LossCurveSceneProps) {
	const evaluations = evaluationsOf(input);
	const toPlot = (epoch: number, loss: number): PlotPosition => ({
		x: PLOT_PADDING + (epoch / input.epochs) * (PLOT_WIDTH - 2 * PLOT_PADDING),
		y: PLOT_TOP + PLOT_PADDING + (1 - Math.min(LOSS_MAX, loss) / LOSS_MAX) * (PLOT_HEIGHT - 2 * PLOT_PADDING),
	});
	const trainPoint = (evaluation: Evaluation) => toPlot(evaluation.epoch, evaluation.trainLoss);
	const evalPoint = (evaluation: Evaluation) => toPlot(evaluation.epoch, evaluation.evalLoss);
	const shown = (index: number) => index < evaluationsShown;
	const bestIndex = bestIndexAmong(evaluations.slice(0, evaluationsShown));
	const latestIndex = evaluationsShown - 1;
	const evalSegmentTone = (index: number): LinkTone => (evaluations[index + 1].evalLoss > evaluations[index].evalLoss ? 'remove' : 'focus');

	return (
		<PlotCanvas width={PLOT_WIDTH} height={PLOT_TOP + PLOT_HEIGHT + 4}>
			<Plane left={0} top={PLOT_TOP} width={PLOT_WIDTH} height={PLOT_HEIGHT} label={`loss (0 to ${LOSS_MAX}) against epoch (0 to ${input.epochs})`} />
			{evaluations.slice(1).map((evaluation, index) => (
				<Link key={`train-${index}`} from={trainPoint(evaluations[index])} to={trainPoint(evaluation)} hidden={!shown(index + 1)} />
			))}
			{evaluations.slice(1).map((evaluation, index) => (
				<Link key={`eval-${index}`} from={evalPoint(evaluations[index])} to={evalPoint(evaluation)} tone={evalSegmentTone(index)} hidden={!shown(index + 1)} />
			))}
			{evaluations.map((evaluation, index) => (
				<Dot key={`train-dot-${index}`} position={trainPoint(evaluation)} label={index === latestIndex ? 'train' : undefined} hidden={!shown(index)} />
			))}
			{evaluations.map((evaluation, index) => (
				<Dot key={`eval-dot-${index}`} position={evalPoint(evaluation)} tone={index === bestIndex ? 'add' : 'focus'} label={index === latestIndex ? 'eval' : undefined} hidden={!shown(index)} />
			))}
			<Ring position={evalPoint(evaluations[bestIndex])} label="best" />
		</PlotCanvas>
	);
}

export default defineExplainer<LossCurveInput, LossCurveStep>({
	title: 'Loss curves: when to stop training',
	stages: [
		{
			title: 'Train loss and eval loss, every half epoch',
			subtitle: 'Grey line with dark dots: train loss. Teal: eval loss while it falls; dashed red where it rises. The green dot and the ring mark the best checkpoint so far.',
			Scene: LossCurveScene,
		},
	],
	examples: [
		{ input: { trainingExamples: 200, epochs: 6 }, note: 'Small dataset, many epochs: overfits early' },
		{ input: { trainingExamples: 800, epochs: 5 }, note: 'Best checkpoint before the end' },
		{ input: { trainingExamples: 3200, epochs: 3 }, note: 'Large dataset: still improving' },
	],
	fields: [
		{ name: 'examples', label: 'training examples', placeholder: `${MIN_EXAMPLES} to ${MAX_EXAMPLES}` },
		{ name: 'epochs', label: 'epochs', placeholder: `1 to ${MAX_EPOCHS}` },
	],
	describe: ({ trainingExamples, epochs }) => `${trainingExamples} examples, ${epochs} epochs`,
	parse(values) {
		const trainingExamples = Number(values.examples);
		if (values.examples === '' || !Number.isInteger(trainingExamples) || trainingExamples < MIN_EXAMPLES || trainingExamples > MAX_EXAMPLES)
			return { error: `Training examples must be a whole number from ${MIN_EXAMPLES} to ${MAX_EXAMPLES}.` };
		const epochs = Number(values.epochs);
		if (values.epochs === '' || !Number.isInteger(epochs) || epochs < 1 || epochs > MAX_EPOCHS) return { error: `Epochs must be a whole number from 1 to ${MAX_EPOCHS}.` };
		return { input: { trainingExamples, epochs } };
	},
	steps: buildSteps,
});
