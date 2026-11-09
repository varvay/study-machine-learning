import { Link, LinkLabel, NodeBox, PlotCanvas, type CellTone, type LinkTone, type PlotPosition } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

interface NetworkInput {
	inputs: [number, number];
	target: number;
}

interface HiddenNeuron {
	weights: [number, number];
	bias: number;
}

interface OutputNeuron {
	weights: number[];
	bias: number;
}

interface Weights {
	hidden: HiddenNeuron[];
	output: OutputNeuron;
}

interface ForwardPass {
	sums: number[];
	hidden: number[];
	output: number;
	loss: number;
}

interface Gradients {
	output: number;
	outputWeights: number[];
	hiddenSums: number[];
	hiddenWeights: [number, number][];
}

type Phase = 'network' | 'inputs' | 'hidden' | 'output' | 'loss' | 'backward-output' | 'backward-hidden' | 'update' | 'forward-again';

interface NetworkStep extends Step {
	phase: Phase;
	hiddenIndex: number;
}

type NetworkSceneProps = SceneProps<NetworkInput, NetworkStep>;

const LEARNING_RATE = 0.1;
const HIDDEN_NAMES = ['h₁', 'h₂', 'h₃'];
const INPUT_NAMES = ['x₁', 'x₂'];

const INITIAL_WEIGHTS: Weights = {
	hidden: [
		{ weights: [0.8, -0.4], bias: 0.1 },
		{ weights: [-0.6, 0.3], bias: 0.2 },
		{ weights: [0.5, 0.9], bias: -0.3 },
	],
	output: { weights: [0.6, -0.5, 0.4], bias: 0.1 },
};

const relu = (value: number) => Math.max(0, value);

function forward(weights: Weights, inputs: [number, number], target: number): ForwardPass {
	const sums = weights.hidden.map((neuron) => neuron.weights[0] * inputs[0] + neuron.weights[1] * inputs[1] + neuron.bias);
	const hidden = sums.map(relu);
	const output = hidden.reduce((sum, value, index) => sum + weights.output.weights[index] * value, weights.output.bias);
	return { sums, hidden, output, loss: (output - target) ** 2 };
}

function backward(weights: Weights, inputs: [number, number], pass: ForwardPass, target: number): Gradients {
	const output = 2 * (pass.output - target);
	const outputWeights = pass.hidden.map((value) => output * value);
	const hiddenSums = pass.sums.map((sum, index) => (sum > 0 ? output * weights.output.weights[index] : 0));
	const hiddenWeights = hiddenSums.map((gradient): [number, number] => [gradient * inputs[0], gradient * inputs[1]]);
	return { output, outputWeights, hiddenSums, hiddenWeights };
}

function updated(weights: Weights, gradients: Gradients): Weights {
	return {
		hidden: weights.hidden.map((neuron, index) => ({
			weights: [
				neuron.weights[0] - LEARNING_RATE * gradients.hiddenWeights[index][0],
				neuron.weights[1] - LEARNING_RATE * gradients.hiddenWeights[index][1],
			],
			bias: neuron.bias - LEARNING_RATE * gradients.hiddenSums[index],
		})),
		output: {
			weights: weights.output.weights.map((weight, index) => weight - LEARNING_RATE * gradients.outputWeights[index]),
			bias: weights.output.bias - LEARNING_RATE * gradients.output,
		},
	};
}

function trainingRound({ inputs, target }: NetworkInput) {
	const before = forward(INITIAL_WEIGHTS, inputs, target);
	const gradients = backward(INITIAL_WEIGHTS, inputs, before, target);
	const after = updated(INITIAL_WEIGHTS, gradients);
	return { before, gradients, after, afterPass: forward(after, inputs, target) };
}

const format = (value: number) => (Object.is(Math.round(value * 100), -0) ? '0.00' : value.toFixed(2));
const term = (value: number) => (value < 0 ? `(${format(value)})` : format(value));
const formatLoss = (value: number) => value.toFixed(3);

function hiddenNarration(index: number, inputs: [number, number], pass: ForwardPass) {
	const neuron = INITIAL_WEIGHTS.hidden[index];
	const sum = pass.sums[index];
	const formula = `${HIDDEN_NAMES[index]} = ReLU(${term(neuron.weights[0])} × ${term(inputs[0])} + ${term(neuron.weights[1])} × ${term(inputs[1])} + ${term(neuron.bias)}) = ReLU(${format(sum)}) = ${format(pass.hidden[index])}`;
	const reading =
		sum > 0
			? 'The sum is positive, so ReLU passes it through.'
			: 'The sum is negative, so ReLU outputs 0: this neuron is silent for this input, and nothing downstream depends on its weights right now.';
	const lead = index === 0 ? 'Hidden neuron 1 multiplies each input by the weight on its line, adds its bias b, and applies ReLU. ' : '';
	return `${lead}${formula}. ${reading}`;
}

function outputFormula(weights: Weights, pass: ForwardPass) {
	const products = pass.hidden.map((value, index) => `${term(weights.output.weights[index])} × ${format(value)}`).join(' + ');
	return `ŷ = ${products} + ${term(weights.output.bias)} = ${format(pass.output)}`;
}

function buildSteps(input: NetworkInput): NetworkStep[] {
	const { inputs, target } = input;
	const { before, gradients, afterPass } = trainingRound(input);
	const silent = before.hidden.map((value, index) => (value === 0 ? HIDDEN_NAMES[index] : '')).filter(Boolean);
	const readout = (pass?: ForwardPass) => ({ 'output ŷ': pass ? format(pass.output) : '–', 'target y': format(target), loss: pass ? formatLoss(pass.loss) : '–' });
	const step = (phase: Phase, narration: string, pass?: ForwardPass, hiddenIndex = -1): NetworkStep => ({ phase, hiddenIndex, narration, readout: readout(pass) });
	const direction = gradients.output < 0 ? 'Negative means a larger ŷ would lower the loss.' : 'Positive means a smaller ŷ would lower the loss.';
	const firstHidden = before.hidden.findIndex((value) => value > 0);
	const exampleChain =
		firstHidden < 0
			? 'Every hidden neuron is silent for this input, so no first-layer weight gets a gradient.'
			: `For example, the weight from x₁ to ${HIDDEN_NAMES[firstHidden]}: ${format(gradients.output)} × ${term(INITIAL_WEIGHTS.output.weights[firstHidden])} × 1 (ReLU was on) × ${term(inputs[0])} = ${format(gradients.hiddenWeights[firstHidden][0])}.`;
	const silentNote = silent.length > 0 ? ` ${silent.join(' and ')} ${silent.length === 1 ? 'outputs' : 'output'} 0, so ReLU passes no gradient back through ${silent.length === 1 ? 'it' : 'them'}: ${silent.length === 1 ? 'its' : 'their'} incoming weights get a gradient of 0.` : '';

	return [
		step('network', 'A small network: 2 inputs, a hidden layer of 3 neurons, and 1 output. Every line is a weight, one learnable number; each hidden neuron and the output also have a bias b. Training will adjust all 13 numbers.'),
		step('inputs', `The input arrives: x₁ = ${format(inputs[0])}, x₂ = ${format(inputs[1])}. The correct answer, the target, is y = ${format(target)}.`),
		...[0, 1, 2].map((index) => step('hidden', hiddenNarration(index, inputs, before), undefined, index)),
		step('output', `The output neuron does the same with the three hidden values, without ReLU, to give the network's prediction ŷ (y-hat): ${outputFormula(INITIAL_WEIGHTS, before)}. That completes the forward pass.`, before),
		step('loss', `The loss measures the miss: (ŷ − y)² = (${format(before.output)} − ${format(target)})² = ${formatLoss(before.loss)}. Training wants it smaller, and needs to know how each weight moves it.`, before),
		step(
			'backward-output',
			`Backpropagation starts at the loss. Its gradient for ŷ is 2(ŷ − y) = ${format(gradients.output)}. ${direction} Each output weight's gradient is that number times the hidden value on its line, shown in red.`,
			before,
		),
		step(
			'backward-hidden',
			`The gradient flows one layer back by the chain rule: for a first-layer weight, multiply the output gradient, the output weight on the path, ReLU's slope (1 if the neuron was on, 0 if not), and the input. ${exampleChain}${silentNote}`,
			before,
		),
		step(
			'update',
			`Gradient descent, shown on its own in the next walkthrough: every weight and bias moves against its gradient, w ← w − η × gradient, with learning rate η = ${LEARNING_RATE}. Green labels changed; weights with a zero gradient stay put.`,
			before,
		),
		step(
			'forward-again',
			`A new forward pass with the updated weights gives ŷ = ${format(afterPass.output)}, against ${format(before.output)} before. The loss went from ${formatLoss(before.loss)} to ${formatLoss(afterPass.loss)}. Training repeats this forward, backward, update loop over many examples.`,
			afterPass,
		),
	];
}

const PHASES: Phase[] = ['network', 'inputs', 'hidden', 'output', 'loss', 'backward-output', 'backward-hidden', 'update', 'forward-again'];
const reached = (phase: Phase, milestone: Phase) => PHASES.indexOf(phase) >= PHASES.indexOf(milestone);

const INPUT_POSITIONS: PlotPosition[] = [
	{ x: 44, y: 120 },
	{ x: 44, y: 220 },
];
const HIDDEN_POSITIONS: PlotPosition[] = [
	{ x: 320, y: 70 },
	{ x: 320, y: 170 },
	{ x: 320, y: 270 },
];
const OUTPUT_POSITION: PlotPosition = { x: 560, y: 170 };
const TARGET_POSITION: PlotPosition = { x: 690, y: 100 };
const LOSS_POSITION: PlotPosition = { x: 690, y: 240 };
const CANVAS_WIDTH = 730;
const CANVAS_HEIGHT = 305;
const FIRST_LAYER_LABEL_AT = 0.62;

function NetworkScene({ input, step: { phase, hiddenIndex } }: NetworkSceneProps) {
	const { before, gradients, after, afterPass } = trainingRound(input);
	const showsNewWeights = reached(phase, 'update');
	const weights = showsNewWeights ? after : INITIAL_WEIGHTS;
	const pass = phase === 'forward-again' ? afterPass : before;
	const hiddenShown = (index: number) => (phase === 'hidden' ? index <= hiddenIndex : reached(phase, 'output'));

	const firstLayerLabel = (neuron: number, source: number): { text: string; tone: LinkTone } => {
		if (phase === 'backward-hidden') return { text: `∇ ${format(gradients.hiddenWeights[neuron][source])}`, tone: 'remove' };
		const changed = gradients.hiddenWeights[neuron][source] !== 0;
		return { text: format(weights.hidden[neuron].weights[source]), tone: phase === 'update' && changed ? 'add' : phase === 'hidden' && neuron === hiddenIndex ? 'focus' : 'plain' };
	};
	const outputLabel = (neuron: number): { text: string; tone: LinkTone } => {
		if (phase === 'backward-output' || phase === 'backward-hidden') return { text: `∇ ${format(gradients.outputWeights[neuron])}`, tone: 'remove' };
		const changed = gradients.outputWeights[neuron] !== 0;
		return { text: format(weights.output.weights[neuron]), tone: phase === 'update' && changed ? 'add' : phase === 'output' ? 'focus' : 'plain' };
	};
	const hiddenTone = (index: number): CellTone => {
		if (phase === 'hidden' && index === hiddenIndex) return 'focus';
		if (phase === 'backward-hidden' && before.hidden[index] > 0) return 'remove';
		return 'plain';
	};
	const outputTone: CellTone = phase === 'output' ? 'focus' : phase === 'backward-output' ? 'remove' : 'plain';
	const lossTone: CellTone = phase === 'loss' ? 'remove' : phase === 'forward-again' ? 'add' : 'plain';

	return (
		<PlotCanvas width={CANVAS_WIDTH} height={CANVAS_HEIGHT}>
			{HIDDEN_POSITIONS.map((hidden, neuron) =>
				INPUT_POSITIONS.map((source, index) => {
					const label = firstLayerLabel(neuron, index);
					return [
						<Link key={`first-${neuron}-${index}`} from={source} to={hidden} tone={label.tone === 'plain' ? 'plain' : label.tone} />,
						<LinkLabel key={`first-label-${neuron}-${index}`} from={source} to={hidden} along={FIRST_LAYER_LABEL_AT} text={label.text} tone={label.tone} />,
					];
				}),
			)}
			{HIDDEN_POSITIONS.map((hidden, neuron) => {
				const label = outputLabel(neuron);
				return [
					<Link key={`second-${neuron}`} from={hidden} to={OUTPUT_POSITION} tone={label.tone} />,
					<LinkLabel key={`second-label-${neuron}`} from={hidden} to={OUTPUT_POSITION} text={label.text} tone={label.tone} />,
				];
			})}
			<Link key="to-loss" from={OUTPUT_POSITION} to={LOSS_POSITION} />
			<Link key="target-to-loss" from={TARGET_POSITION} to={LOSS_POSITION} />
			{INPUT_POSITIONS.map((position, index) => (
				<NodeBox
					key={`input-${index}`}
					position={position}
					label={INPUT_NAMES[index]}
					value={reached(phase, 'inputs') ? format(input.inputs[index]) : '?'}
					tone={phase === 'inputs' ? 'focus' : 'plain'}
				/>
			))}
			{HIDDEN_POSITIONS.map((position, index) => (
				<NodeBox
					key={`hidden-${index}`}
					position={position}
					label={`${HIDDEN_NAMES[index]} · b ${format(weights.hidden[index].bias)}`}
					value={hiddenShown(index) ? format(pass.hidden[index]) : '?'}
					tone={hiddenTone(index)}
				/>
			))}
			<NodeBox
				key="output"
				position={OUTPUT_POSITION}
				label={`ŷ · b ${format(weights.output.bias)}`}
				value={reached(phase, 'output') ? format(pass.output) : '?'}
				tone={outputTone}
			/>
			<NodeBox key="target" position={TARGET_POSITION} label="target y" value={reached(phase, 'inputs') ? format(input.target) : '?'} />
			<NodeBox key="loss" position={LOSS_POSITION} label="loss (ŷ − y)²" value={reached(phase, 'loss') ? formatLoss(pass.loss) : '?'} tone={lossTone} />
		</PlotCanvas>
	);
}

const isInRange = (value: number) => Number.isFinite(value) && value >= -2 && value <= 2;

export default defineExplainer<NetworkInput, NetworkStep>({
	title: 'One training step through a small network',
	stages: [
		{
			title: 'Forward, backward, update',
			subtitle: 'Numbers on the lines are weights; during backpropagation they show gradients (∇) in red. Each box shows the value a neuron computed.',
			Scene: NetworkScene,
		},
	],
	examples: [
		{ input: { inputs: [1, 0.5], target: 1 }, note: 'Output too low' },
		{ input: { inputs: [0.2, 0.9], target: 0 }, note: 'Output too high' },
		{ input: { inputs: [-1, 0.5], target: 0.5 }, note: 'Two neurons silent' },
	],
	fields: [
		{ name: 'x1', label: 'x₁', placeholder: '−2 to 2' },
		{ name: 'x2', label: 'x₂', placeholder: '−2 to 2' },
		{ name: 'target', label: 'target y', placeholder: '−2 to 2' },
	],
	describe: ({ inputs, target }) => `x = (${format(inputs[0])}, ${format(inputs[1])}), y = ${format(target)}`,
	parse(values) {
		const [x1, x2, target] = [values.x1, values.x2, values.target].map((raw) => (raw === '' ? Number.NaN : Number(raw)));
		if (![x1, x2, target].every(isInRange)) return { error: 'Use numbers from −2 to 2 for x₁, x₂, and the target.' };
		return { input: { inputs: [x1, x2], target } };
	},
	steps: buildSteps,
});
