import { Canvas, Cell, Chips, RowLabel, Tag, type CellTone, type Chip, type ChipState } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

type IsolationLevel = 'read committed' | 'repeatable read';
type WriteOutcome = 'commit' | 'rollback';
type TransactionStatus = 'not started' | 'in progress' | 'committed' | 'aborted';
type TransactionId = number;

interface Write {
	delta: number;
	outcome: WriteOutcome;
}

interface MvccInput {
	level: IsolationLevel;
	writes: Write[];
}

interface RowVersion {
	id: number;
	balance: number;
	xmin: TransactionId;
	xmax: TransactionId;
}

interface MvccStep extends Step {
	versions: RowVersion[];
	statuses: Record<TransactionId, TransactionStatus>;
	actor: TransactionId;
	readerVersion?: number;
	newTransactionVersion: number;
	deadVersions: number[];
	recentlyDeadVersions: number[];
	vacuumedVersions: RowVersion[];
}

type MvccSceneProps = SceneProps<MvccInput, MvccStep>;

const START_BALANCE = 100;
const CREATOR_XID = 100;
const READER_XID = 101;
const FIRST_WRITER_XID = 102;
const NO_XID = 0;
const MAX_WRITES = 4;
const MAX_BALANCE = 999;

const BALANCE_TOP = 30;
const XMIN_TOP = 92;
const XMAX_TOP = 154;
const READER_TOP = 226;
const NEW_TRANSACTION_TOP = 258;
const SCENE_HEIGHT = 290;

const writerXid = (writeIndex: number) => FIRST_WRITER_XID + writeIndex;
const levelShort = (level: IsolationLevel) => (level === 'read committed' ? 'RC' : 'RR');
const levelName = (level: IsolationLevel) => (level === 'read committed' ? 'Read Committed' : 'Repeatable Read');
const signed = (delta: number) => (delta < 0 ? `− ${-delta}` : `+ ${delta}`);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

class MvccSimulation {
	versions: RowVersion[] = [{ id: 0, balance: START_BALANCE, xmin: CREATOR_XID, xmax: NO_XID }];
	statuses: Record<TransactionId, TransactionStatus>;
	readonly readerSnapshot = new Set<TransactionId>([CREATOR_XID]);

	constructor(private readonly input: MvccInput) {
		this.statuses = { [CREATOR_XID]: 'committed', [READER_XID]: 'in progress' };
		input.writes.forEach((_, index) => (this.statuses[writerXid(index)] = 'not started'));
	}

	committedNow() {
		const ids = Object.entries(this.statuses)
			.filter(([, status]) => status === 'committed')
			.map(([id]) => Number(id));
		return new Set(ids);
	}

	visibleIn(committed: Set<TransactionId>) {
		return this.versions.find((version) => committed.has(version.xmin) && !(version.xmax !== NO_XID && committed.has(version.xmax)));
	}

	isReplaced(version: RowVersion) {
		return this.statuses[version.xmin] === 'aborted' || (version.xmax !== NO_XID && this.statuses[version.xmax] === 'committed');
	}

	isRecentlyDead(version: RowVersion) {
		return this.isReplaced(version) && version.id === this.readerVersion()?.id;
	}

	isDead(version: RowVersion) {
		return this.isReplaced(version) && !this.isRecentlyDead(version);
	}

	liveVersion() {
		return this.visibleIn(this.committedNow())!;
	}

	readerVersion() {
		if (this.statuses[READER_XID] !== 'in progress') return undefined;
		return this.input.level === 'read committed' ? this.visibleIn(this.committedNow()) : this.visibleIn(this.readerSnapshot);
	}

	update(writeIndex: number) {
		const xid = writerXid(writeIndex);
		const live = this.liveVersion();
		live.xmax = xid;
		const created: RowVersion = { id: this.versions.length, balance: live.balance + this.input.writes[writeIndex].delta, xmin: xid, xmax: NO_XID };
		this.versions.push(created);
		this.statuses[xid] = 'in progress';
		return { previous: live, created };
	}

	finish(writeIndex: number) {
		this.statuses[writerXid(writeIndex)] = this.input.writes[writeIndex].outcome === 'commit' ? 'committed' : 'aborted';
	}

	commitReader() {
		this.statuses[READER_XID] = 'committed';
	}

	vacuum() {
		const removed = this.versions.filter((version) => this.isDead(version));
		this.versions = this.versions.filter((version) => !this.isDead(version));
		return removed;
	}

	snapshotStep(actor: TransactionId, narration: string, vacuumedVersions: RowVersion[] = []): MvccStep {
		const reader = this.readerVersion();
		const newTransaction = this.liveVersion();
		const idsWhere = (test: (version: RowVersion) => boolean) => this.versions.filter(test).map((version) => version.id);
		const deadVersions = idsWhere((version) => this.isDead(version));
		return {
			versions: this.versions.map((version) => ({ ...version })),
			statuses: { ...this.statuses },
			actor,
			readerVersion: reader?.id,
			newTransactionVersion: newTransaction.id,
			deadVersions,
			recentlyDeadVersions: idsWhere((version) => this.isRecentlyDead(version)),
			vacuumedVersions,
			narration,
			readout: {
				'T101 sees': reader?.balance ?? '–',
				'new txn sees': newTransaction.balance,
				versions: this.versions.length,
				dead: deadVersions.length,
			},
		};
	}
}

function introNarration(level: IsolationLevel) {
	const snapshotRule =
		level === 'repeatable read'
			? 'At Repeatable Read, the snapshot taken at its first read holds for the whole transaction: only transaction 100 had committed then.'
			: 'At Read Committed, every statement takes a fresh snapshot of what has committed so far.';
	return `Transaction 100 inserted the row with balance ${START_BALANCE}, so this version has xmin = 100 (who created it) and xmax = 0 (nobody deleted it). Reader T101 has begun at ${levelName(level)} and read the row once. ${snapshotRule} Each snapshot sees exactly one version of the row.`;
}

function readersClause(simulation: MvccSimulation) {
	const reader = simulation.readerVersion();
	return `T101 sees ${reader?.balance}; a new transaction sees ${simulation.liveVersion().balance}.`;
}

function updateNarration(xid: TransactionId, write: Write, created: RowVersion, simulation: MvccSimulation) {
	return `Transaction ${xid} runs <code>UPDATE … SET balance = balance ${signed(write.delta)}</code>. PostgreSQL does not overwrite the row: it writes a new version (${created.balance}, xmin = ${xid}) and stamps the old version's xmax = ${xid}. ${xid} has not committed, so other snapshots ignore both stamps: ${readersClause(simulation)}`;
}

function commitNarration(xid: TransactionId, level: IsolationLevel, previous: RowVersion, simulation: MvccSimulation) {
	const reader = simulation.readerVersion()!;
	const live = simulation.liveVersion();
	const opening = `Transaction ${xid} commits, so its stamps now count for every new snapshot: ${live.balance} is the live version.`;
	if (level === 'read committed')
		return `${opening} T101 runs its SELECT again; the statement takes a new snapshot, which includes ${xid}, so T101 now sees ${reader.balance}. No snapshot can see the replaced ${previous.balance} version any more: it is dead.`;
	const replaced = simulation.isRecentlyDead(previous)
		? `The replaced ${previous.balance} version is invisible to new transactions, but T101's snapshot still sees it, so it must stay: it is <b>recently dead</b> (faded).`
		: `The replaced ${previous.balance} version is visible to no snapshot, T101's included: it is dead.`;
	return `${opening} T101 runs its SELECT again, but at Repeatable Read it keeps its first snapshot, in which ${xid} had not committed, so it still sees ${reader.balance}. ${replaced}`;
}

function rollbackNarration(xid: TransactionId, previous: RowVersion, created: RowVersion, simulation: MvccSimulation) {
	return `Transaction ${xid} rolls back. Nothing is erased: the ${created.balance} version stays in the table, but its xmin is an aborted transaction, so no snapshot will ever see it. The old version's xmax = ${xid} is ignored for the same reason, so ${previous.balance} stays live. ${readersClause(simulation)}`;
}

function readerCommitNarration(simulation: MvccSimulation, heldBack?: RowVersion) {
	const dead = simulation.versions.filter((version) => simulation.isDead(version)).length;
	const released = heldBack ? ` The ${heldBack.balance} version it was holding turns from recently dead to dead.` : '';
	return `T101 commits, so no running transaction holds an old snapshot.${released} ${plural(dead, 'version')} (red) ${dead === 1 ? 'is' : 'are'} dead: invisible to every present and future transaction, yet still taking space until VACUUM runs.`;
}

function vacuumNarration(removed: RowVersion[], heldBack?: RowVersion) {
	const held = heldBack
		? ` Had VACUUM run while T101 was open, it would have had to keep the ${heldBack.balance} version: one long transaction holds back cleanup for every table in its database.`
		: '';
	return `VACUUM removes the ${plural(removed.length, 'dead version')} and records the space as free for new rows of this table; the file shrinks only if whole empty pages sit at its end. One version remains, the one every transaction sees.${held}`;
}

function buildSteps(input: MvccInput): MvccStep[] {
	const simulation = new MvccSimulation(input);
	const steps: MvccStep[] = [simulation.snapshotStep(READER_XID, introNarration(input.level))];
	let readerLastSeen = simulation.readerVersion();

	input.writes.forEach((write, index) => {
		const xid = writerXid(index);
		const { previous, created } = simulation.update(index);
		steps.push(simulation.snapshotStep(xid, updateNarration(xid, write, created, simulation)));
		simulation.finish(index);
		const narration = write.outcome === 'commit' ? commitNarration(xid, input.level, previous, simulation) : rollbackNarration(xid, previous, created, simulation);
		steps.push(simulation.snapshotStep(xid, narration));
		readerLastSeen = simulation.readerVersion();
	});

	const heldBack = readerLastSeen && simulation.isRecentlyDead(readerLastSeen) ? { ...readerLastSeen } : undefined;
	simulation.commitReader();
	steps.push(simulation.snapshotStep(READER_XID, readerCommitNarration(simulation, heldBack)));
	const removed = simulation.vacuum();
	steps.push(simulation.snapshotStep(NO_XID, vacuumNarration(removed, heldBack), removed));
	return steps;
}

function versionTone(version: RowVersion, { statuses, deadVersions, vacuumedVersions }: MvccStep): CellTone {
	if (statuses[version.xmin] === 'in progress') return 'focus';
	const dead = deadVersions.includes(version.id) || vacuumedVersions.some((vacuumed) => vacuumed.id === version.id);
	return dead ? 'remove' : 'plain';
}

function stampTone(xid: TransactionId, statuses: MvccStep['statuses']): CellTone {
	if (xid === NO_XID) return 'plain';
	if (statuses[xid] === 'in progress') return 'focus';
	return statuses[xid] === 'aborted' ? 'remove' : 'plain';
}

function VersionsScene({ input, step }: MvccSceneProps) {
	const { versions, statuses, readerVersion, newTransactionVersion, vacuumedVersions } = step;
	const vacuumed = vacuumedVersions.length > 0;
	const allVersionIds = Array.from({ length: input.writes.length + 1 }, (_, id) => id);
	const shown = (id: number) => versions.find((version) => version.id === id);
	const drawn = (id: number) => shown(id) ?? vacuumedVersions.find((version) => version.id === id);
	const survivorColumn = (id: number) => versions.findIndex((version) => version.id === id);
	const columnOf = (id: number) => (vacuumed && survivorColumn(id) >= 0 ? survivorColumn(id) : id);

	return (
		<Canvas columns={input.writes.length + 1} height={SCENE_HEIGHT}>
			<RowLabel top={BALANCE_TOP + 16}>balance</RowLabel>
			<RowLabel top={XMIN_TOP + 16}>xmin</RowLabel>
			<RowLabel top={XMAX_TOP + 16}>xmax</RowLabel>
			<RowLabel top={READER_TOP}>T101</RowLabel>
			<RowLabel top={NEW_TRANSACTION_TOP}>new txn</RowLabel>
			{allVersionIds.map((id) => {
				const version = drawn(id);
				const hidden = !shown(id);
				const column = columnOf(id);
				return [
					<Cell
						key={`balance-${id}`}
						value={version?.balance ?? ''}
						column={column}
						top={BALANCE_TOP}
						tone={version ? versionTone(version, step) : 'plain'}
						dimmed={step.recentlyDeadVersions.includes(id)}
						hidden={hidden}
					/>,
					<Cell key={`xmin-${id}`} value={version?.xmin ?? ''} column={column} top={XMIN_TOP} tone={version ? stampTone(version.xmin, statuses) : 'plain'} hidden={hidden} />,
					<Cell key={`xmax-${id}`} value={version?.xmax ?? ''} column={column} top={XMAX_TOP} tone={version ? stampTone(version.xmax, statuses) : 'plain'} hidden={hidden} />,
				];
			})}
			<Tag key="reader-sees" column={readerVersion === undefined ? 0 : columnOf(readerVersion)} top={READER_TOP} tone="add" hidden={readerVersion === undefined}>
				sees
			</Tag>
			<Tag key="new-transaction-sees" column={columnOf(newTransactionVersion)} top={NEW_TRANSACTION_TOP} tone="add">
				sees
			</Tag>
		</Canvas>
	);
}

function transactionLabel(xid: TransactionId, input: MvccInput) {
	if (xid === CREATOR_XID) return 'inserted the row';
	if (xid === READER_XID) return `reader, ${levelShort(input.level)}`;
	return `balance ${signed(input.writes[xid - FIRST_WRITER_XID].delta)}`;
}

function TransactionChips({ input, step: { statuses, actor } }: MvccSceneProps) {
	const chipState = (xid: TransactionId): ChipState => {
		if (xid === actor) return 'current';
		return statuses[xid] === 'not started' ? 'upcoming' : 'plain';
	};
	const chips: Chip[] = Object.keys(statuses)
		.map(Number)
		.sort((a, b) => a - b)
		.map((xid) => ({ label: `${xid} · ${transactionLabel(xid, input)} · ${statuses[xid]}`, state: chipState(xid) }));
	return <Chips chips={chips} />;
}

function parseLevel(raw: string): IsolationLevel | undefined {
	const normalized = raw.toLowerCase().replace(/\s+/g, ' ');
	if (['rc', 'read committed'].includes(normalized)) return 'read committed';
	if (['rr', 'repeatable read'].includes(normalized)) return 'repeatable read';
	return undefined;
}

function parseWrites(raw: string): Write[] | string {
	const tokens = raw.split(/[\s,]+/).filter(Boolean);
	if (tokens.length === 0 || tokens.length > MAX_WRITES) return `Enter 1 to ${MAX_WRITES} updates, e.g. +50 -30x.`;
	const writes: Write[] = [];
	for (const token of tokens) {
		const match = /^([+-])(\d{1,3})(x?)$/i.exec(token);
		if (!match) return `"${token}" is not an update: write a signed amount such as +50 or -30, and add x to roll it back (-30x).`;
		const delta = Number(match[2]) * (match[1] === '-' ? -1 : 1);
		if (delta === 0) return 'An update of 0 changes nothing; use a non-zero amount.';
		writes.push({ delta, outcome: match[3] ? 'rollback' : 'commit' });
	}
	return writes;
}

function balancesStayInRange(writes: Write[]) {
	let balance = START_BALANCE;
	for (const write of writes) {
		const next = balance + write.delta;
		if (next < 0 || next > MAX_BALANCE) return false;
		if (write.outcome === 'commit') balance = next;
	}
	return true;
}

const describeWrite = (write: Write) => `${write.delta > 0 ? '+' : ''}${write.delta}${write.outcome === 'rollback' ? 'x' : ''}`;

export default defineExplainer<MvccInput, MvccStep>({
	title: 'MVCC: row versions and who sees them',
	stages: [
		{
			title: 'One row, several versions',
			subtitle:
				'Each column is one stored version of the same row, stamped with xmin (the transaction that created it) and xmax (the transaction that deleted or replaced it; 0 if none). Blue: written by a transaction still in progress. Faded: recently dead, replaced but still visible to an older snapshot. Red: dead, visible to no present or future snapshot. The "sees" tags mark the version each reader gets.',
			Scene: VersionsScene,
			Footer: TransactionChips,
		},
	],
	examples: [
		{ input: { level: 'repeatable read', writes: [{ delta: 50, outcome: 'commit' }, { delta: -30, outcome: 'commit' }] }, note: 'Repeatable Read keeps one snapshot' },
		{ input: { level: 'read committed', writes: [{ delta: 50, outcome: 'commit' }, { delta: -30, outcome: 'commit' }] }, note: 'Read Committed: a snapshot per statement' },
		{ input: { level: 'repeatable read', writes: [{ delta: 50, outcome: 'rollback' }, { delta: -30, outcome: 'commit' }] }, note: 'A rolled-back update' },
	],
	fields: [
		{ name: 'level', label: 'reader isolation', placeholder: 'rc or rr' },
		{ name: 'writes', label: 'updates (x = roll back)', placeholder: 'e.g. +50 -30x +20' },
	],
	describe: ({ level, writes }) => `${levelShort(level)} · ${writes.map(describeWrite).join(' ')}`,
	parse(values) {
		const level = parseLevel(values.level);
		if (!level) return { error: 'Isolation is rc (Read Committed) or rr (Repeatable Read).' };
		const writes = parseWrites(values.writes);
		if (typeof writes === 'string') return { error: writes };
		if (!balancesStayInRange(writes)) return { error: `Starting from ${START_BALANCE}, keep every balance between 0 and ${MAX_BALANCE}.` };
		return { input: { level, writes } };
	},
	steps: buildSteps,
});
