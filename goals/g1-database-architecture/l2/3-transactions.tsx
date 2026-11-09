import { Canvas, Cell, RowLabel, SubLabel, Tag, type CellTone } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

type Anomaly = 'dirty-read' | 'non-repeatable-read' | 'phantom-read' | 'lost-update' | 'write-skew';
type IsolationLevel = 'read-uncommitted' | 'read-committed' | 'repeatable-read' | 'serializable';
type Session = 'A' | 'B';
type Verdict = 'anomaly' | 'prevented';

interface InterleavingInput {
	anomaly: Anomaly;
	level: IsolationLevel;
}

interface Action {
	session: Session;
	shown: string;
	label: string;
	committedAfter: number;
	narration: string;
	verdict?: Verdict;
	failed?: boolean;
}

interface Scenario {
	setup: string;
	committedName: string;
	initialCommitted: number;
	actions: Action[];
	summary: string;
}

interface InterleavingStep extends Step {
	visibleActions: number;
}

type InterleavingSceneProps = SceneProps<InterleavingInput, InterleavingStep>;

const anomalyNames: Record<Anomaly, string> = {
	'dirty-read': 'dirty read',
	'non-repeatable-read': 'non-repeatable read',
	'phantom-read': 'phantom read',
	'lost-update': 'lost update',
	'write-skew': 'write skew',
};

const levelNames: Record<IsolationLevel, string> = {
	'read-uncommitted': 'Read Uncommitted',
	'read-committed': 'Read Committed',
	'repeatable-read': 'Repeatable Read',
	serializable: 'Serializable',
};

const anomalyDefinitions: Record<Anomaly, string> = {
	'dirty-read': 'A <b>dirty read</b> is reading a change that another transaction has not committed yet. If that transaction rolls back, the reader acted on a value that never existed.',
	'non-repeatable-read': 'A <b>non-repeatable read</b> is reading the same row twice in one transaction and getting different values, because another transaction changed the row and committed in between.',
	'phantom-read': 'A <b>phantom read</b> is running the same search twice in one transaction and getting a different set of rows, because another transaction inserted or deleted matching rows and committed in between.',
	'lost-update': 'A <b>lost update</b> is two transactions reading the same value, each computing a new value from it, and the second write overwriting the first as if it never happened.',
	'write-skew': 'A <b>write skew</b> is two transactions reading the same data, each checking a rule against it, then each updating a different row. Each write is valid alone; together they break the rule.',
};

const readsFreshEachStatement = (level: IsolationLevel) => level === 'read-uncommitted' || level === 'read-committed';

const levelAsRunByPostgres = (level: IsolationLevel) =>
	level === 'read-uncommitted' ? 'Read Uncommitted, which PostgreSQL runs as Read Committed,' : levelNames[level];

const balanceQuery = "<code>SELECT balance FROM accounts WHERE id = 'A'</code>";
const onCallQuery = '<code>SELECT count(*) FROM doctors WHERE on_call</code>';

function dirtyRead(level: IsolationLevel): Scenario {
	const secondRead =
		level === 'read-uncommitted'
			? "A reads again and gets 100. The SQL standard lets Read Uncommitted return B's uncommitted 20 here; PostgreSQL runs Read Uncommitted as Read Committed, so it never does."
			: "A reads again and gets 100. A statement sees only committed data, so B's 20 stays invisible to A.";
	return {
		setup: "Table <code>accounts</code> holds one row: account 'A' with balance 100.",
		committedName: 'balance',
		initialCommitted: 100,
		actions: [
			{ session: 'A', shown: '100', label: 'read', committedAfter: 100, narration: `A runs ${balanceQuery} and gets 100.` },
			{ session: 'B', shown: '20', label: 'write', committedAfter: 100, narration: "B runs <code>UPDATE accounts SET balance = 20 WHERE id = 'A'</code>. B has not committed, so the committed balance is still 100." },
			{ session: 'A', shown: '100', label: 'read', committedAfter: 100, verdict: 'prevented', narration: secondRead },
			{ session: 'B', shown: '↺', label: 'rollback', committedAfter: 100, narration: 'B runs <code>ROLLBACK</code>. Its 20 is discarded; A never saw it.' },
			{ session: 'A', shown: '✓', label: 'commit', committedAfter: 100, narration: 'A runs <code>COMMIT</code>.' },
		],
		summary: 'No dirty read: PostgreSQL prevents it at every level, Read Uncommitted included.',
	};
}

function nonRepeatableRead(level: IsolationLevel): Scenario {
	const secondRead: Pick<Action, 'shown' | 'verdict' | 'narration'> = readsFreshEachStatement(level)
		? {
				shown: '20',
				verdict: 'anomaly',
				narration: `A runs the same query and gets 20. ${levelAsRunByPostgres(level)} gives each statement a new snapshot, so this one sees B's commit: a non-repeatable read.`,
			}
		: {
				shown: '100',
				verdict: 'prevented',
				narration: `A runs the same query and still gets 100. ${levelNames[level]} keeps one snapshot, taken at A's first statement, for the whole transaction, so B's commit stays invisible to A.`,
			};
	return {
		setup: "Table <code>accounts</code> holds one row: account 'A' with balance 100.",
		committedName: 'balance',
		initialCommitted: 100,
		actions: [
			{ session: 'A', shown: '100', label: 'read', committedAfter: 100, narration: `A runs ${balanceQuery} and gets 100.` },
			{ session: 'B', shown: '20', label: 'write', committedAfter: 100, narration: "B runs <code>UPDATE accounts SET balance = 20 WHERE id = 'A'</code>." },
			{ session: 'B', shown: '✓', label: 'commit', committedAfter: 20, narration: 'B runs <code>COMMIT</code>. The committed balance is now 20.' },
			{ session: 'A', label: 'read', committedAfter: 20, ...secondRead },
			{ session: 'A', shown: '✓', label: 'commit', committedAfter: 20, narration: 'A runs <code>COMMIT</code>.' },
		],
		summary: readsFreshEachStatement(level)
			? 'A read one row twice and got two values. Repeatable Read or Serializable prevents it.'
			: 'A read the same value both times. Repeatable Read is the weakest level that prevents a non-repeatable read.',
	};
}

function phantomRead(level: IsolationLevel): Scenario {
	const secondCount: Pick<Action, 'shown' | 'verdict' | 'narration'> = readsFreshEachStatement(level)
		? {
				shown: '3',
				verdict: 'anomaly',
				narration: `A runs the same count and gets 3: a row that did not match before now appears. That new row is a phantom.`,
			}
		: {
				shown: '2',
				verdict: 'prevented',
				narration: `A runs the same count and still gets 2. The SQL standard allows phantoms at Repeatable Read; PostgreSQL's single snapshot hides Carol's row, so it has none.`,
			};
	return {
		setup: 'Table <code>doctors</code> has Alice and Bob, both on call.',
		committedName: 'on call',
		initialCommitted: 2,
		actions: [
			{ session: 'A', shown: '2', label: 'count', committedAfter: 2, narration: `A runs ${onCallQuery} and gets 2.` },
			{ session: 'B', shown: '+1', label: 'insert', committedAfter: 2, narration: "B runs <code>INSERT INTO doctors VALUES ('carol', true)</code>." },
			{ session: 'B', shown: '✓', label: 'commit', committedAfter: 3, narration: 'B runs <code>COMMIT</code>. Three doctors are now on call.' },
			{ session: 'A', label: 'count', committedAfter: 3, ...secondCount },
			{ session: 'A', shown: '✓', label: 'commit', committedAfter: 3, narration: 'A runs <code>COMMIT</code>.' },
		],
		summary: readsFreshEachStatement(level)
			? 'The same search returned a different set of rows. In PostgreSQL, Repeatable Read or Serializable prevents it.'
			: 'The search returned the same rows both times. In PostgreSQL, Repeatable Read is the weakest level that prevents phantoms.',
	};
}

function lostUpdate(level: IsolationLevel): Scenario {
	const overwrites = readsFreshEachStatement(level);
	const resumedWrite: Pick<Action, 'shown' | 'label' | 'verdict' | 'failed' | 'narration'> = overwrites
		? {
				shown: '20',
				label: 'write',
				verdict: 'anomaly',
				narration: `B's UPDATE now runs against A's committed row and writes 20. ${levelAsRunByPostgres(level)} does not check that B's 100 is out of date, so A's withdrawal is overwritten: a lost update.`,
			}
		: {
				shown: '✗',
				label: 'error',
				verdict: 'prevented',
				failed: true,
				narration: `B's UPDATE fails: <code>ERROR: could not serialize access due to concurrent update</code>. A changed the row after B's snapshot was taken, and ${levelNames[level]} refuses to overwrite a change B could not see.`,
			};
	const finish: Action = overwrites
		? { session: 'B', shown: '✓', label: 'commit', committedAfter: 20, narration: 'B runs <code>COMMIT</code>. Both withdrawals succeeded: 160 paid out from an account that held 100, and the balance shows 20.' }
		: {
				session: 'B',
				shown: '↺',
				label: 'rollback',
				committedAfter: 20,
				narration: "B's <code>COMMIT</code> on a failed transaction returns <code>ROLLBACK</code>. The application retries B from the start: it reads 20 and refuses the second withdrawal.",
			};
	return {
		setup: "Account 'A' holds 100. Each session withdraws 80: it reads the balance, checks it covers 80, and writes the new balance its code computed.",
		committedName: 'balance',
		initialCommitted: 100,
		actions: [
			{ session: 'A', shown: '100', label: 'read', committedAfter: 100, narration: `A runs ${balanceQuery}: 100 covers 80.` },
			{ session: 'B', shown: '100', label: 'read', committedAfter: 100, narration: 'B runs the same query: 100 covers 80.' },
			{ session: 'A', shown: '20', label: 'write', committedAfter: 100, narration: "A computes 100 − 80 = 20 and runs <code>UPDATE accounts SET balance = 20 WHERE id = 'A'</code>. The UPDATE locks the row until A ends." },
			{ session: 'B', shown: '…', label: 'waits', committedAfter: 100, narration: 'B also computed 20 and runs the same UPDATE. A holds the row lock, so B waits.' },
			{ session: 'A', shown: '✓', label: 'commit', committedAfter: 20, narration: 'A runs <code>COMMIT</code>. The balance is 20 and the lock is released.' },
			{ session: 'B', committedAfter: 20, ...resumedWrite },
			finish,
		],
		summary: overwrites
			? 'One withdrawal was lost. Repeatable Read or Serializable turns it into an error to retry; at Read Committed, SELECT … FOR UPDATE or a version column prevents it.'
			: 'The second withdrawal failed instead of overwriting the first. Repeatable Read is the weakest PostgreSQL level that prevents a lost update.',
	};
}

function writeSkew(level: IsolationLevel): Scenario {
	const skewed = level !== 'serializable';
	const whyUndetected = readsFreshEachStatement(level)
		? `${levelAsRunByPostgres(level)} checks nothing across transactions beyond row locks, and these locked different rows.`
		: 'Repeatable Read only detects two writes to the same row, and these wrote different rows.';
	const secondCommit: Action = skewed
		? {
				session: 'B',
				shown: '✓',
				label: 'commit',
				committedAfter: 0,
				verdict: 'anomaly',
				narration: `B's <code>COMMIT</code> succeeds. Each check was true in its own snapshot, yet no doctor is on call: write skew. ${whyUndetected}`,
			}
		: {
				session: 'B',
				shown: '✗',
				label: 'error',
				committedAfter: 1,
				verdict: 'prevented',
				failed: true,
				narration:
					"B's <code>COMMIT</code> fails: <code>ERROR: could not serialize access due to read/write dependencies among transactions</code>. Serializable tracks what each transaction read: B read Alice's row, which A changed, and A read Bob's row, which B changed. No one-at-a-time order gives that result, so B must retry; it will count 1 and stay on call.",
			};
	return {
		setup: 'Rule: at least one doctor stays on call. Alice and Bob are both on call, and each asks to leave at the same moment.',
		committedName: 'on call',
		initialCommitted: 2,
		actions: [
			{ session: 'A', shown: '2', label: 'count', committedAfter: 2, narration: `A (Alice) runs ${onCallQuery}: 2, so Alice may leave.` },
			{ session: 'B', shown: '2', label: 'count', committedAfter: 2, narration: 'B (Bob) runs the same count: 2, so Bob may leave.' },
			{ session: 'A', shown: 'off', label: 'write', committedAfter: 2, narration: "A runs <code>UPDATE doctors SET on_call = false WHERE name = 'alice'</code>." },
			{ session: 'B', shown: 'off', label: 'write', committedAfter: 2, narration: "B runs <code>UPDATE doctors SET on_call = false WHERE name = 'bob'</code>. A different row, so B does not wait for A." },
			{ session: 'A', shown: '✓', label: 'commit', committedAfter: 1, narration: 'A runs <code>COMMIT</code>. One doctor is on call.' },
			secondCommit,
		],
		summary: skewed
			? 'The rule broke although each transaction checked it. Only Serializable prevents write skew; below it, lock the rows you check with SELECT … FOR UPDATE.'
			: 'The rule held: one transaction was rolled back. Serializable is the only level that prevents write skew.',
	};
}

const scenarioBuilders: Record<Anomaly, (level: IsolationLevel) => Scenario> = {
	'dirty-read': dirtyRead,
	'non-repeatable-read': nonRepeatableRead,
	'phantom-read': phantomRead,
	'lost-update': lostUpdate,
	'write-skew': writeSkew,
};

const scenarioOf = ({ anomaly, level }: InterleavingInput) => scenarioBuilders[anomaly](level);

const committedAt = (scenario: Scenario, visibleActions: number) =>
	visibleActions === 0 ? scenario.initialCommitted : scenario.actions[visibleActions - 1].committedAfter;

function buildSteps(input: InterleavingInput): InterleavingStep[] {
	const scenario = scenarioOf(input);
	const readoutAt = (visibleActions: number) => ({ level: levelNames[input.level], [`committed ${scenario.committedName}`]: committedAt(scenario, visibleActions) });
	const intro: InterleavingStep = {
		visibleActions: 0,
		readout: readoutAt(0),
		narration: `${anomalyDefinitions[input.anomaly]} ${scenario.setup} Sessions A and B each run <code>BEGIN ISOLATION LEVEL ${levelNames[input.level].toUpperCase()}</code>.`,
	};
	const actionSteps = scenario.actions.map((action, index) => ({
		visibleActions: index + 1,
		readout: readoutAt(index + 1),
		narration: action.narration,
	}));
	const summary: InterleavingStep = {
		visibleActions: scenario.actions.length,
		readout: readoutAt(scenario.actions.length),
		narration: scenario.summary,
	};
	return [intro, ...actionSteps, summary];
}

const TIME_TOP = 12;
const rowTops: Record<Session | 'committed', number> = { A: 40, B: 146, committed: 252 };
const SUB_LABEL_OFFSET = 58;
const TAG_OFFSET = 78;
const SCENE_HEIGHT = rowTops.committed + 84;

function sessionTone(action: Action, isCurrent: boolean): CellTone {
	if (action.failed || action.verdict === 'anomaly') return 'remove';
	if (action.verdict === 'prevented') return 'add';
	return isCurrent ? 'focus' : 'plain';
}

function InterleavingScene({ input, step: { visibleActions } }: InterleavingSceneProps) {
	const scenario = scenarioOf(input);
	const columns = scenario.actions.length + 1;
	const committedValues = [scenario.initialCommitted, ...scenario.actions.map((action) => action.committedAfter)];
	return (
		<Canvas columns={columns} height={SCENE_HEIGHT}>
			<RowLabel top={rowTops.A + 18}>session A</RowLabel>
			<RowLabel top={rowTops.B + 18}>session B</RowLabel>
			<RowLabel top={rowTops.committed + 8}>
				committed
				<br />
				{scenario.committedName}
			</RowLabel>
			<SubLabel column={0} top={TIME_TOP}>
				start
			</SubLabel>
			{scenario.actions.map((action, index) => {
				const column = index + 1;
				const hidden = column > visibleActions;
				const isCurrent = column === visibleActions;
				const top = rowTops[action.session];
				const waitedAndResumed = action.label === 'waits' && !isCurrent;
				return [
					<SubLabel key={`time-${column}`} column={column} top={TIME_TOP} hidden={hidden}>
						t{column}
					</SubLabel>,
					<Cell key={`action-${column}`} value={action.shown} column={column} top={top} tone={sessionTone(action, isCurrent)} dimmed={waitedAndResumed} hidden={hidden} />,
					<SubLabel key={`label-${column}`} column={column} top={top + SUB_LABEL_OFFSET} hidden={hidden}>
						{action.label}
					</SubLabel>,
					action.verdict && (
						<Tag key={`verdict-${column}`} column={column} top={top + TAG_OFFSET} tone={action.verdict === 'anomaly' ? 'remove' : 'add'} hidden={hidden}>
							{action.verdict}
						</Tag>
					),
				];
			})}
			{committedValues.map((value, column) => {
				const changed = column > 0 && value !== committedValues[column - 1];
				return (
					<Cell
						key={`committed-${column}`}
						value={value}
						column={column}
						top={rowTops.committed}
						tone={changed && column === visibleActions ? 'focus' : 'plain'}
						hidden={column > visibleActions}
					/>
				);
			})}
		</Canvas>
	);
}

const normalized = (raw: string) => raw.toLowerCase().replace(/[^a-z]/g, '');

function parseAnomaly(raw: string): Anomaly | undefined {
	const word = normalized(raw);
	if (word.startsWith('dirty')) return 'dirty-read';
	if (word.startsWith('nonrepeatable')) return 'non-repeatable-read';
	if (word.startsWith('phantom')) return 'phantom-read';
	if (word.startsWith('lost')) return 'lost-update';
	if (word === 'skew' || word.startsWith('writeskew')) return 'write-skew';
	return undefined;
}

const levelAliases: Record<string, IsolationLevel> = {
	ru: 'read-uncommitted',
	readuncommitted: 'read-uncommitted',
	rc: 'read-committed',
	readcommitted: 'read-committed',
	rr: 'repeatable-read',
	repeatableread: 'repeatable-read',
	s: 'serializable',
	serializable: 'serializable',
};

export default defineExplainer<InterleavingInput, InterleavingStep>({
	title: 'Two sessions interleaved: anomalies and isolation levels',
	stages: [
		{
			title: 'One timeline, two sessions',
			subtitle: 'Each column is one statement, left to right in time. Top rows: what each session read, wrote, or ended with. Bottom row: the committed value every new snapshot would see.',
			Scene: InterleavingScene,
		},
	],
	examples: [
		{ input: { anomaly: 'non-repeatable-read', level: 'read-committed' }, note: 'Appears' },
		{ input: { anomaly: 'non-repeatable-read', level: 'repeatable-read' }, note: 'Prevented' },
		{ input: { anomaly: 'phantom-read', level: 'read-committed' }, note: 'Appears' },
		{ input: { anomaly: 'lost-update', level: 'read-committed' }, note: 'Appears' },
		{ input: { anomaly: 'lost-update', level: 'repeatable-read' }, note: 'Error, retry' },
		{ input: { anomaly: 'write-skew', level: 'repeatable-read' }, note: 'Appears' },
		{ input: { anomaly: 'write-skew', level: 'serializable' }, note: 'Error, retry' },
		{ input: { anomaly: 'dirty-read', level: 'read-uncommitted' }, note: 'Never in PostgreSQL' },
	],
	fields: [
		{ name: 'anomaly', label: 'anomaly', placeholder: 'dirty, nonrepeatable, phantom, lost, skew' },
		{ name: 'level', label: 'level', placeholder: 'RU, RC, RR, S' },
	],
	describe: ({ anomaly, level }) => `${anomalyNames[anomaly]} · ${levelNames[level]}`,
	parse(values) {
		const anomaly = parseAnomaly(values.anomaly);
		if (!anomaly) return { error: 'Name an anomaly: dirty, nonrepeatable, phantom, lost, or skew.' };
		const level = levelAliases[normalized(values.level)];
		if (!level) return { error: 'Name a level: RU (Read Uncommitted), RC (Read Committed), RR (Repeatable Read), or S (Serializable).' };
		return { input: { anomaly, level } };
	},
	steps: buildSteps,
});
