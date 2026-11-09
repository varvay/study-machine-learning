import { Dot, Link, Plane, PlotCanvas, Ring, type PlotPosition } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

interface StoppingInput {
	patience: number;
	validationLosses: number[];
}

type Phase = 'start' | 'epoch' | 'restore';

interface StoppingStep extends Step {
	phase: Phase;
	epochsShown: number;
	bestEpoch?: number;
}

type StoppingSceneProps = SceneProps<StoppingInput, StoppingStep>;

interface EpochOutcome {
	epoch: number;
	loss: number;
	improved: boolean;
	bestEpoch: number;
	waited: number;
	stops: boolean;
}

const MAX_EPOCHS = 20;
const MAX_PATIENCE = 10;

const trainingLoss = (epoch: number) => 0.03 + 0.6 * Math.exp(-epoch / 5);

function runEarlyStopping({ patience, validationLosses }: StoppingInput): EpochOutcome[] {
	const outcomes: EpochOutcome[] = [];
	let bestEpoch = 0;
	let bestLoss = Infinity;
	let waited = 0;
	for (const [index, loss] of validationLosses.entries()) {
		const epoch = index + 1;
		const improved = loss < bestLoss;
		if (improved) {
			bestEpoch = epoch;
			bestLoss = loss;
			waited = 0;
		} else {
			waited += 1;
		}
		const stops = waited === patience;
		outcomes.push({ epoch, loss, improved, bestEpoch, waited, stops });
		if (stops) break;
	}
	return outcomes;
}

const three = (value: number) => value.toFixed(3);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function epochNarration(outcome: EpochOutcome, previousBest: number | undefined, patience: number, lossOf: (epoch: number) => number) {
	const head = `Epoch ${outcome.epoch}: training loss ${three(trainingLoss(outcome.epoch))}, validation loss ${three(outcome.loss)}.`;
	if (outcome.improved)
		return previousBest === undefined
			? `${head} The first result is the best so far: save a copy of the weights (a checkpoint).`
			: `${head} Lower than the best so far (${three(lossOf(previousBest))}, epoch ${previousBest}): save a checkpoint and reset the wait to 0.`;
	const wait = `No improvement on ${three(lossOf(outcome.bestEpoch))} (epoch ${outcome.bestEpoch}): wait ${outcome.waited} of ${patience}.`;
	return outcome.stops ? `${head} ${wait} Patience is used up, so training <b>stops</b>.` : `${head} ${wait}`;
}

function discardedClause(laterEpochs: number) {
	if (laterEpochs === 0) return 'no later epoch is discarded';
	return laterEpochs === 1 ? 'the epoch after it is discarded' : `the ${laterEpochs} epochs after it are discarded`;
}

function restoreNarration(outcomes: EpochOutcome[], input: StoppingInput) {
	const last = outcomes.at(-1)!;
	const bestEpoch = last.bestEpoch;
	const lowest = Math.min(...input.validationLosses);
	const lowestEpoch = input.validationLosses.indexOf(lowest) + 1;
	const reason = last.stops ? `Training stopped after epoch ${last.epoch}` : `Training reached the last epoch, ${last.epoch}, without running out of patience`;
	const restored = `${reason}. Restore the checkpoint from epoch ${bestEpoch} (validation loss ${three(input.validationLosses[bestEpoch - 1])}); ${discardedClause(last.epoch - bestEpoch)}.`;
	if (lowestEpoch > last.epoch)
		return `${restored} The validation loss would have reached ${three(lowest)} at epoch ${lowestEpoch}: patience ${input.patience} <b>stopped too early</b>, fooled by a bump.`;
	if (last.epoch - bestEpoch > 5) return `${restored} That is the best model this run could reach; a smaller patience would have stopped sooner, at the risk of stopping at a bump.`;
	if (input.validationLosses[last.epoch - 1] > trainingLoss(last.epoch))
		return `${restored} Meanwhile the training loss kept falling: the widening gap between the two curves is the model memorizing its training data.`;
	return restored;
}

function buildSteps(input: StoppingInput): StoppingStep[] {
	const outcomes = runEarlyStopping(input);
	const lossOf = (epoch: number) => input.validationLosses[epoch - 1];
	const readoutAt = (outcome?: EpochOutcome) =>
		outcome
			? { epoch: outcome.epoch, 'val loss': three(outcome.loss), 'best epoch': outcome.bestEpoch, wait: `${outcome.waited}/${input.patience}` }
			: { epoch: '–', 'val loss': '–', 'best epoch': '–', wait: `0/${input.patience}` };
	const steps: StoppingStep[] = [
		{
			phase: 'start',
			epochsShown: 0,
			readout: readoutAt(),
			narration: `After each epoch the loop measures the loss on the validation set, which it never trains on. Early stopping keeps the weights from the epoch with the lowest validation loss, and stops once the validation loss has not improved for ${plural(input.patience, 'epoch')} in a row, a number called the <b>patience</b>.`,
		},
	];
	outcomes.forEach((outcome, index) => {
		const previousBest = index === 0 ? undefined : outcomes[index - 1].bestEpoch;
		steps.push({ phase: 'epoch', epochsShown: outcome.epoch, bestEpoch: outcome.bestEpoch, readout: readoutAt(outcome), narration: epochNarration(outcome, previousBest, input.patience, lossOf) });
	});
	const last = outcomes.at(-1)!;
	steps.push({ phase: 'restore', epochsShown: last.epoch, bestEpoch: last.bestEpoch, readout: readoutAt(last), narration: restoreNarration(outcomes, input) });
	return steps;
}

const PLOT_WIDTH = 600;
const PLOT_HEIGHT = 300;
const PLOT_TOP = 24;
const PADDING = 22;

function StoppingScene({ input, step: { phase, epochsShown, bestEpoch } }: StoppingSceneProps) {
	const epochs = input.validationLosses.map((_, index) => index + 1);
	const trainingLosses = epochs.map(trainingLoss);
	const lossCeiling = Math.max(...input.validationLosses, ...trainingLosses) * 1.08;
	const toPlot = (epoch: number, loss: number): PlotPosition => ({
		x: PADDING + ((epoch - 1) / Math.max(1, epochs.length - 1)) * (PLOT_WIDTH - 2 * PADDING),
		y: PLOT_TOP + PADDING + (1 - loss / lossCeiling) * (PLOT_HEIGHT - 2 * PADDING),
	});
	const validationAt = (epoch: number) => toPlot(epoch, input.validationLosses[epoch - 1]);
	const ringEpoch = phase === 'restore' ? bestEpoch : epochsShown;

	return (
		<PlotCanvas width={PLOT_WIDTH} height={PLOT_TOP + PLOT_HEIGHT + 4}>
			<Plane left={0} top={PLOT_TOP} width={PLOT_WIDTH} height={PLOT_HEIGHT} label={`loss (up) by epoch (across, 1 to ${epochs.length}) · grey: training · teal: validation`} active={epochsShown > 0} />
			{epochs.slice(1).map((epoch) => [
				<Link key={`train-${epoch}`} from={toPlot(epoch - 1, trainingLoss(epoch - 1))} to={toPlot(epoch, trainingLoss(epoch))} hidden={epoch > epochsShown} />,
				<Link key={`validation-${epoch}`} from={validationAt(epoch - 1)} to={validationAt(epoch)} tone="focus" hidden={epoch > epochsShown} />,
			])}
			{epochs.map((epoch) => [
				<Dot key={`train-dot-${epoch}`} position={toPlot(epoch, trainingLoss(epoch))} ghost hidden={epoch > epochsShown} />,
				<Dot
					key={`validation-dot-${epoch}`}
					position={validationAt(epoch)}
					tone={epoch === bestEpoch ? 'add' : 'focus'}
					label={epoch === bestEpoch ? 'best' : undefined}
					hidden={epoch > epochsShown}
				/>,
			])}
			<Ring position={ringEpoch ? validationAt(ringEpoch) : validationAt(1)} hidden={!ringEpoch} label={phase === 'restore' ? 'restored' : undefined} />
		</PlotCanvas>
	);
}

export default defineExplainer<StoppingInput, StoppingStep>({
	title: 'Early stopping: keep the best epoch',
	stages: [
		{
			title: 'Training and validation loss, epoch by epoch',
			subtitle: 'The ring is the current epoch; the green dot is the best validation loss so far, the checkpoint that early stopping keeps.',
			Scene: StoppingScene,
		},
	],
	examples: [
		{ input: { patience: 1, validationLosses: [0.62, 0.45, 0.36, 0.3, 0.27, 0.28, 0.24, 0.23, 0.235, 0.22, 0.225, 0.23, 0.24, 0.25, 0.27, 0.29, 0.31, 0.33, 0.36, 0.39] }, note: 'Patience 1: too eager' },
		{ input: { patience: 3, validationLosses: [0.62, 0.45, 0.36, 0.3, 0.27, 0.28, 0.24, 0.23, 0.235, 0.22, 0.225, 0.23, 0.24, 0.25, 0.27, 0.29, 0.31, 0.33, 0.36, 0.39] }, note: 'Patience 3' },
		{ input: { patience: 8, validationLosses: [0.62, 0.45, 0.36, 0.3, 0.27, 0.28, 0.24, 0.23, 0.235, 0.22, 0.225, 0.23, 0.24, 0.25, 0.27, 0.29, 0.31, 0.33, 0.36, 0.39] }, note: 'Patience 8: same model, more epochs' },
	],
	fields: [
		{ name: 'patience', label: 'patience', placeholder: `1–${MAX_PATIENCE}` },
		{ name: 'losses', label: 'validation loss per epoch', placeholder: 'e.g. 0.6 0.4 0.3 0.32 0.35' },
	],
	describe: ({ patience, validationLosses }) => `patience ${patience} · ${validationLosses.length} epochs`,
	parse(values) {
		const patience = Number(values.patience);
		if (values.patience === '' || !Number.isInteger(patience) || patience < 1 || patience > MAX_PATIENCE) return { error: `Patience is a whole number from 1 to ${MAX_PATIENCE}.` };
		const validationLosses = values.losses
			.split(/[\s,]+/)
			.filter(Boolean)
			.map(Number);
		if (validationLosses.length < 2 || validationLosses.length > MAX_EPOCHS) return { error: `Enter from 2 to ${MAX_EPOCHS} validation losses, one per epoch.` };
		if (validationLosses.some((loss) => !Number.isFinite(loss) || loss <= 0)) return { error: 'Losses are positive numbers, such as 0.35.' };
		return { input: { patience, validationLosses } };
	},
	steps: buildSteps,
});
