import { Canvas, Cell, RowLabel, SceneNote, type CellTone } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

interface MemoryInput {
	modelName?: string;
	totalParamsBillions: number;
	sixteenBitParamsBillions: number;
	adapterParamsMillions: number;
	gpuGigabytes: number;
	activationGigabytes: number;
}

type Phase = 'empty' | 'weights' | 'gradients' | 'optimizer' | 'activations' | 'verdict';
type Method = 'full' | 'lora' | 'qlora';
type BlockKind = 'weights' | 'gradients' | 'optimizer' | 'adapters' | 'activations';

interface MemoryStep extends Step {
	phase: Phase;
}

interface Block {
	kind: BlockKind;
	gigabytes: number;
}

type MemorySceneProps = SceneProps<MemoryInput, MemoryStep>;

const PHASE_ORDER: Phase[] = ['empty', 'weights', 'gradients', 'optimizer', 'activations', 'verdict'];

const BF16_BYTES = 2;
const FULL_GRADIENT_BYTES = 2;
const FULL_OPTIMIZER_BYTES = 12;
const NF4_BITS_WITH_CONSTANTS = 4 + 0.127;
const ADAPTER_STATE_BYTES = 16;
const DEFAULT_ADAPTER_SHARE = 0.005;
const DEFAULT_ACTIVATION_GIGABYTES = 2;

const CELLS_PER_ROW = 10;
const MAX_CAPACITY_CELLS = 40;
const MAX_DRAWN_CELLS = 80;
const CELL_SCALES_IN_GIGABYTES = [1, 2, 4, 8, 16, 32, 64];
const CELL_PITCH = 62;
const GRID_TOP = 8;

const BLOCK_LETTER: Record<BlockKind, string> = { weights: 'W', gradients: 'G', optimizer: 'O', adapters: 'L', activations: 'A' };
const BLOCK_TONE: Record<BlockKind, CellTone> = { weights: 'focus', gradients: 'add', optimizer: 'add', adapters: 'add', activations: 'plain' };

const phaseIndex = (phase: Phase) => PHASE_ORDER.indexOf(phase);
const shows = (current: Phase, since: Phase) => phaseIndex(current) >= phaseIndex(since);

const quantizedWeightGigabytes = ({ totalParamsBillions, sixteenBitParamsBillions }: MemoryInput) =>
	((totalParamsBillions - sixteenBitParamsBillions) * NF4_BITS_WITH_CONSTANTS) / 8 + sixteenBitParamsBillions * BF16_BYTES;

const adapterGigabytes = ({ adapterParamsMillions }: MemoryInput) => (adapterParamsMillions / 1000) * ADAPTER_STATE_BYTES;

function blocksAt(input: MemoryInput, method: Method, phase: Phase): Block[] {
	const { totalParamsBillions, activationGigabytes } = input;
	const blocks: Block[] = [];
	if (shows(phase, 'weights')) {
		const weights = method === 'qlora' ? quantizedWeightGigabytes(input) : totalParamsBillions * BF16_BYTES;
		blocks.push({ kind: 'weights', gigabytes: weights });
	}
	if (shows(phase, 'gradients')) {
		if (method === 'full') blocks.push({ kind: 'gradients', gigabytes: totalParamsBillions * FULL_GRADIENT_BYTES });
		else blocks.push({ kind: 'adapters', gigabytes: adapterGigabytes(input) });
	}
	if (shows(phase, 'optimizer') && method === 'full') blocks.push({ kind: 'optimizer', gigabytes: totalParamsBillions * FULL_OPTIMIZER_BYTES });
	if (shows(phase, 'activations') && activationGigabytes > 0) blocks.push({ kind: 'activations', gigabytes: activationGigabytes });
	return blocks;
}

const totalOf = (blocks: Block[]) => blocks.reduce((sum, block) => sum + block.gigabytes, 0);
const totalAt = (input: MemoryInput, method: Method, phase: Phase) => totalOf(blocksAt(input, method, phase));

const cellScaleFor = (gpuGigabytes: number) =>
	CELL_SCALES_IN_GIGABYTES.find((scale) => gpuGigabytes / scale <= MAX_CAPACITY_CELLS) ?? CELL_SCALES_IN_GIGABYTES.at(-1)!;

const capacityCellsFor = (input: MemoryInput) => Math.floor(input.gpuGigabytes / cellScaleFor(input.gpuGigabytes));

function cellKinds(input: MemoryInput, method: Method, phase: Phase): BlockKind[] {
	const scale = cellScaleFor(input.gpuGigabytes);
	const kinds: BlockKind[] = [];
	let cumulative = 0;
	for (const block of blocksAt(input, method, phase)) {
		cumulative += block.gigabytes;
		const end = Math.max(kinds.length + 1, Math.round(cumulative / scale));
		while (kinds.length < end) kinds.push(block.kind);
	}
	const fits = cumulative <= input.gpuGigabytes;
	return fits ? kinds.slice(0, Math.max(capacityCellsFor(input), 1)) : kinds;
}

const gigabytes = (value: number) => `${value < 10 ? value.toFixed(2) : value.toFixed(1)} GB`;
const billions = (value: number) => `${value.toFixed(2)} billion`;

function weightsNarration(input: MemoryInput) {
	const full = input.totalParamsBillions * BF16_BYTES;
	const quantized = gigabytes(quantizedWeightGigabytes(input));
	const qlora =
		input.sixteenBitParamsBillions > 0
			? `QLoRA stores the linear layers in 4-bit NF4, 4.127 bits per weight once the quantization constants are counted, and keeps the ${billions(input.sixteenBitParamsBillions)} embedding and output-layer weights at 2 bytes: ${quantized}.`
			: `QLoRA stores every weight in 4-bit NF4, 4.127 bits per weight once the quantization constants are counted: ${quantized}. Real models keep the embedding and output layers at 2 bytes, which adds a little.`;
	return `<b>Weights.</b> Full fine-tuning and LoRA load all ${billions(input.totalParamsBillions)} weights in bf16, 2 bytes each: ${gigabytes(full)}. ${qlora}`;
}

function gradientsNarration(input: MemoryInput) {
	const full = input.totalParamsBillions * FULL_GRADIENT_BYTES;
	return `<b>Gradients.</b> Full fine-tuning stores a gradient for every weight, 2 bytes in bf16: another ${gigabytes(full)}. LoRA and QLoRA freeze the base, so only the ${input.adapterParamsMillions.toFixed(1)} million adapter weights (L) train. Each keeps a 4-byte weight, a 4-byte gradient, and two 4-byte Adam moments, 16 bytes in all: ${gigabytes(adapterGigabytes(input))} for the whole adapter state.`;
}

function optimizerNarration(input: MemoryInput) {
	const optimizer = input.totalParamsBillions * FULL_OPTIMIZER_BYTES;
	return `<b>Optimizer states.</b> Mixed-precision Adam keeps, per trained weight, a 4-byte fp32 master copy and two 4-byte moments: 12 bytes × ${billions(input.totalParamsBillions)} = ${gigabytes(optimizer)} for full fine-tuning, its largest block. LoRA and QLoRA add nothing here: their optimizer state is already inside L.`;
}

function activationsNarration(input: MemoryInput) {
	if (input.activationGigabytes === 0) return '<b>Activations</b> are set to 0 GB here, so nothing is added.';
	return `<b>Activations.</b> The values the forward pass saves for the backward pass: ${gigabytes(input.activationGigabytes)} in this example, for all three methods, since each runs the same forward pass through the same layers. They grow with batch size and sequence length; gradient checkpointing shrinks them by saving only each layer's input and recomputing the rest.`;
}

function verdictNarration(input: MemoryInput) {
	const { gpuGigabytes } = input;
	const methods: [Method, string][] = [
		['full', 'full fine-tuning'],
		['lora', 'LoRA'],
		['qlora', 'QLoRA'],
	];
	const parts = methods.map(([method, label]) => {
		const total = totalAt(input, method, 'verdict');
		return total <= gpuGigabytes ? `${label} ${gigabytes(total)} fits` : `${label} ${gigabytes(total)} does not fit`;
	});
	const full = totalAt(input, 'full', 'verdict');
	const sharding =
		full > gpuGigabytes
			? ` Full fine-tuning would need its states sharded across at least ${Math.ceil(full / gpuGigabytes)} such GPUs (FSDP or DeepSpeed ZeRO-3).`
			: '';
	return `On one ${gpuGigabytes} GB GPU: ${parts.join('; ')}.${sharding} A fit needs headroom too: the CUDA context and memory fragmentation take roughly 1 to 2 GB more (unsourced estimate).`;
}

const NARRATION: Record<Exclude<Phase, 'empty'>, (input: MemoryInput) => string> = {
	weights: weightsNarration,
	gradients: gradientsNarration,
	optimizer: optimizerNarration,
	activations: activationsNarration,
	verdict: verdictNarration,
};

function introNarration(input: MemoryInput) {
	const scale = cellScaleFor(input.gpuGigabytes);
	const model = input.modelName ?? `A ${input.totalParamsBillions}-billion-parameter model`;
	const adapterAssumption = input.modelName
		? ''
		: ` The LoRA adapters are assumed to hold 0.5% of the parameters, about what rank 16 on every linear layer gives Llama 3.1 8B.`;
	return `${model}, fine-tuned three ways on one ${input.gpuGigabytes} GB GPU. Each square is ${scale} GB of GPU memory, rounded; a block smaller than one square still takes one. Faded squares are free; red squares are memory the GPU does not have.${adapterAssumption}`;
}

function buildSteps(input: MemoryInput): MemoryStep[] {
	return PHASE_ORDER.map((phase) => ({
		phase,
		readout: {
			GPU: `${input.gpuGigabytes} GB`,
			full: phase === 'empty' ? '–' : gigabytes(totalAt(input, 'full', phase)),
			LoRA: phase === 'empty' ? '–' : gigabytes(totalAt(input, 'lora', phase)),
			QLoRA: phase === 'empty' ? '–' : gigabytes(totalAt(input, 'qlora', phase)),
		},
		narration: phase === 'empty' ? introNarration(input) : NARRATION[phase](input),
	}));
}

function rowCountFor(input: MemoryInput, method: Method) {
	const drawn = Math.min(cellKinds(input, method, 'verdict').length, MAX_DRAWN_CELLS);
	return Math.ceil(Math.max(capacityCellsFor(input), drawn) / CELLS_PER_ROW);
}

function memoryScene(method: Method) {
	return function MemoryScene({ input, step: { phase } }: MemorySceneProps) {
		const scale = cellScaleFor(input.gpuGigabytes);
		const capacityCells = capacityCellsFor(input);
		const kinds = cellKinds(input, method, phase);
		const drawnKinds = kinds.slice(0, MAX_DRAWN_CELLS);
		const rows = rowCountFor(input, method);
		const slots = rows * CELLS_PER_ROW;
		const hiddenGigabytes = (kinds.length - drawnKinds.length) * scale;
		const noteTop = GRID_TOP + rows * CELL_PITCH + 4;

		const toneOf = (index: number, kind?: BlockKind): CellTone => {
			if (!kind) return 'plain';
			return index >= capacityCells ? 'remove' : BLOCK_TONE[kind];
		};

		return (
			<Canvas columns={CELLS_PER_ROW} height={noteTop + 24}>
				{Array.from({ length: rows }, (_, row) => (
					<RowLabel key={`row-${row}`} top={GRID_TOP + row * CELL_PITCH + 16}>
						{`${row * CELLS_PER_ROW * scale} GB`}
					</RowLabel>
				))}
				{Array.from({ length: slots }, (_, index) => {
					const kind = drawnKinds[index];
					const isFreeSlot = !kind && index < capacityCells;
					return (
						<Cell
							key={`slot-${index}`}
							value={kind ? BLOCK_LETTER[kind] : ''}
							column={index % CELLS_PER_ROW}
							top={GRID_TOP + Math.floor(index / CELLS_PER_ROW) * CELL_PITCH}
							tone={toneOf(index, kind)}
							dimmed={isFreeSlot}
							hidden={!kind && !isFreeSlot}
						/>
					);
				})}
				<SceneNote column={0} top={noteTop} hidden={hiddenGigabytes <= 0}>
					{`+ about ${hiddenGigabytes} GB more that does not fit, not drawn`}
				</SceneNote>
			</Canvas>
		);
	};
}

function parseNumber(raw: string, label: string, minimum: number, maximum: number): number | string {
	const value = Number(raw);
	if (raw === '' || !Number.isFinite(value)) return `Enter a number for ${label}.`;
	if (value < minimum || value > maximum) return `${label} must be between ${minimum} and ${maximum}.`;
	return value;
}

export default defineExplainer<MemoryInput, MemoryStep>({
	title: 'Filling a GPU: full fine-tuning, LoRA, and QLoRA',
	stages: [
		{
			title: 'Full fine-tuning',
			subtitle: 'W weights (bf16) · G gradients · O optimizer states (fp32 master copy and Adam moments) · A activations. Red: does not fit.',
			Scene: memoryScene('full'),
		},
		{
			title: 'LoRA',
			subtitle: 'W frozen weights (bf16) · L adapters with their gradients and optimizer states · A activations. Red: does not fit.',
			Scene: memoryScene('lora'),
		},
		{
			title: 'QLoRA',
			subtitle: 'W frozen weights (4-bit NF4) · L adapters with their gradients and optimizer states · A activations. Red: does not fit.',
			Scene: memoryScene('qlora'),
		},
	],
	examples: [
		{
			input: { modelName: 'Llama 3.1 8B', totalParamsBillions: 8.03, sixteenBitParamsBillions: 1.05, adapterParamsMillions: 41.9, gpuGigabytes: 24, activationGigabytes: 1.9 },
			note: '8B on a 24 GB L4',
		},
		{
			input: { modelName: 'Llama 3.1 8B', totalParamsBillions: 8.03, sixteenBitParamsBillions: 1.05, adapterParamsMillions: 41.9, gpuGigabytes: 16, activationGigabytes: 1.9 },
			note: '8B on a 16 GB T4 (Colab)',
		},
		{
			input: { modelName: 'Llama 3.1 8B', totalParamsBillions: 8.03, sixteenBitParamsBillions: 1.05, adapterParamsMillions: 41.9, gpuGigabytes: 80, activationGigabytes: 1.9 },
			note: '8B on an 80 GB H100',
		},
		{
			input: { modelName: 'Llama 3.3 70B', totalParamsBillions: 70.55, sixteenBitParamsBillions: 2.1, adapterParamsMillions: 207.1, gpuGigabytes: 80, activationGigabytes: 4.3 },
			note: '70B on an 80 GB H100',
		},
		{
			input: { modelName: 'Qwen2.5 1.5B', totalParamsBillions: 1.54, sixteenBitParamsBillions: 0.23, adapterParamsMillions: 18.5, gpuGigabytes: 16, activationGigabytes: 1.5 },
			note: '1.5B on a 16 GB T4',
		},
	],
	fields: [
		{ name: 'params', label: 'parameters (billions)', placeholder: 'e.g. 8' },
		{ name: 'gpu', label: 'GPU memory (GB)', placeholder: 'e.g. 24' },
		{ name: 'activations', label: 'activations (GB)', placeholder: `default ${DEFAULT_ACTIVATION_GIGABYTES}` },
	],
	describe: ({ modelName, totalParamsBillions, gpuGigabytes }) => `${modelName ?? `${totalParamsBillions}B model`} · ${gpuGigabytes} GB GPU`,
	parse(values) {
		const totalParamsBillions = parseNumber(values.params, 'Parameters (billions)', 0.1, 1000);
		if (typeof totalParamsBillions === 'string') return { error: totalParamsBillions };
		const gpuGigabytes = parseNumber(values.gpu, 'GPU memory (GB)', 4, 2000);
		if (typeof gpuGigabytes === 'string') return { error: gpuGigabytes };
		const activationGigabytes = values.activations === '' ? DEFAULT_ACTIVATION_GIGABYTES : parseNumber(values.activations, 'Activations (GB)', 0, 500);
		if (typeof activationGigabytes === 'string') return { error: activationGigabytes };
		return {
			input: {
				totalParamsBillions,
				sixteenBitParamsBillions: 0,
				adapterParamsMillions: totalParamsBillions * 1000 * DEFAULT_ADAPTER_SHARE,
				gpuGigabytes,
				activationGigabytes,
			},
		};
	},
	steps: buildSteps,
});
