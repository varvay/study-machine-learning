import { Canvas, Cell, Chips, SceneNote, SubLabel, type CellTone, type Chip } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

interface Order {
	name: string;
	city: string;
	item: string;
}

interface Customer {
	id: number;
	name: string;
	city: string;
	orderCount: number;
}

interface OrdersInput {
	orders: Order[];
}

type Phase = 'flat' | 'repeats' | 'split' | 'link' | 'done';

interface NormalizeStep extends Step {
	phase: Phase;
}

type NormalizeSceneProps = SceneProps<OrdersInput, NormalizeStep>;

const MAX_ORDERS = 6;
const MAX_VALUE_LENGTH = 4;

const HEADER_TOP = 24;
const FIRST_ROW_TOP = 46;
const ROW_PITCH = 62;

const FLAT_COLUMN = { id: 0, name: 1, city: 2, item: 3 };
const ORDERS_COLUMN = { id: 0, item: 1, customerId: 2 };
const CUSTOMERS_COLUMN = { id: 4, name: 5, city: 6 };
const TOTAL_COLUMNS = 7;

const rowTop = (row: number) => FIRST_ROW_TOP + row * ROW_PITCH;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function customersOf(orders: Order[]): Customer[] {
	const customers: Customer[] = [];
	for (const order of orders) {
		const known = customers.find((customer) => customer.name === order.name);
		if (known) known.orderCount++;
		else customers.push({ id: customers.length + 1, name: order.name, city: order.city, orderCount: 1 });
	}
	return customers;
}

const customerOf = (customers: Customer[], order: Order) => customers.find((customer) => customer.name === order.name)!;

function linkedOrderIndex(orders: Order[], customers: Customer[]) {
	const repeatedOrderIndexes = orders.map((order, index) => (customerOf(customers, order).orderCount > 1 ? index : -1)).filter((index) => index >= 0);
	return repeatedOrderIndexes.at(-1) ?? orders.length - 1;
}

function repeatsNarration(customers: Customer[], orders: Order[]) {
	const repeated = customers.filter((customer) => customer.orderCount > 1);
	if (repeated.length === 0)
		return `No customer repeats yet. The next order from ${orders[0].name} would copy <code>${orders[0].city}</code> into another row.`;
	const copies = repeated.map((customer) => `${customer.name}'s city <code>${customer.city}</code> is stored ${customer.orderCount} times`).join(', and ');
	return `${copies}. A change of city must update every copy; miss one and the rows disagree. This is an <b>update anomaly</b>.`;
}

function buildSteps({ orders }: OrdersInput): NormalizeStep[] {
	const customers = customersOf(orders);
	const linkedIndex = linkedOrderIndex(orders, customers);
	const linkedCustomer = customerOf(customers, orders[linkedIndex]);
	const flatReadout = { tables: 1, 'city values stored': orders.length };
	const splitReadout = { tables: 2, 'city values stored': customers.length };

	return [
		{
			phase: 'flat',
			readout: flatReadout,
			narration: `One table holds all ${plural(orders.length, 'order')}. Every row also carries the customer's name and city.`,
		},
		{
			phase: 'repeats',
			readout: flatReadout,
			narration: repeatsNarration(customers, orders),
		},
		{
			phase: 'split',
			readout: splitReadout,
			narration: `Split the table. Each customer is stored once in <code>customers</code>, named by its primary key <code>id</code>. Each order keeps a foreign key <code>cust_id</code> that points to its customer.`,
		},
		{
			phase: 'link',
			readout: splitReadout,
			narration: `Order ${linkedIndex + 1} stores only <code>cust_id = ${linkedCustomer.id}</code>. A join follows that key to row ${linkedCustomer.id} of <code>customers</code> to read ${linkedCustomer.name}'s city.`,
		},
		{
			phase: 'done',
			readout: splitReadout,
			narration: `Each fact is stored once: ${plural(customers.length, 'city value')} instead of ${orders.length}. A change of city updates one row, and every order sees it. Both tables are in <b>3NF</b>.`,
		},
	];
}

function TablesScene({ input: { orders }, step: { phase } }: NormalizeSceneProps) {
	const customers = customersOf(orders);
	const split = phase !== 'flat' && phase !== 'repeats';
	const linkedIndex = linkedOrderIndex(orders, customers);
	const linkedCustomer = customerOf(customers, orders[linkedIndex]);
	const height = rowTop(Math.max(orders.length, 1)) + 4;

	const orderTone = (index: number): CellTone => (phase === 'link' && index === linkedIndex ? 'focus' : 'plain');
	const customerTone = (customer: Customer): CellTone => {
		if (phase === 'repeats' && customer.orderCount > 1) return 'remove';
		if (phase === 'link' && customer === linkedCustomer) return 'focus';
		return 'plain';
	};
	const isFirstOrderOf = (customer: Customer, index: number) => orders.findIndex((order) => order.name === customer.name) === index;

	return (
		<Canvas columns={TOTAL_COLUMNS} height={height}>
			<SceneNote column={0} top={0}>
				{split ? 'orders' : 'orders — one flat table'}
			</SceneNote>
			<SceneNote column={CUSTOMERS_COLUMN.id} top={0} hidden={!split}>
				customers
			</SceneNote>

			<SubLabel column={FLAT_COLUMN.id} top={HEADER_TOP}>id</SubLabel>
			<SubLabel column={split ? CUSTOMERS_COLUMN.name : FLAT_COLUMN.name} top={HEADER_TOP}>name</SubLabel>
			<SubLabel column={split ? CUSTOMERS_COLUMN.city : FLAT_COLUMN.city} top={HEADER_TOP}>city</SubLabel>
			<SubLabel column={split ? ORDERS_COLUMN.item : FLAT_COLUMN.item} top={HEADER_TOP}>item</SubLabel>
			<SubLabel column={ORDERS_COLUMN.customerId} top={HEADER_TOP} hidden={!split}>cust_id</SubLabel>
			<SubLabel column={CUSTOMERS_COLUMN.id} top={HEADER_TOP} hidden={!split}>id</SubLabel>

			{orders.map((order, index) => {
				const customer = customerOf(customers, order);
				const customerRowTop = rowTop(customer.id - 1);
				return [
					<Cell key={`order-id-${index}`} value={index + 1} column={ORDERS_COLUMN.id} top={rowTop(index)} tone={orderTone(index)} />,
					<Cell
						key={`item-${index}`}
						value={order.item}
						column={split ? ORDERS_COLUMN.item : FLAT_COLUMN.item}
						top={rowTop(index)}
						tone={orderTone(index)}
					/>,
					<Cell
						key={`customer-id-${index}`}
						value={customer.id}
						column={ORDERS_COLUMN.customerId}
						top={rowTop(index)}
						tone={phase === 'split' ? 'add' : orderTone(index)}
						hidden={!split}
					/>,
					<Cell
						key={`name-${index}`}
						value={order.name}
						column={split ? CUSTOMERS_COLUMN.name : FLAT_COLUMN.name}
						top={split ? customerRowTop : rowTop(index)}
						tone={customerTone(customer)}
						hidden={split && !isFirstOrderOf(customer, index)}
					/>,
					<Cell
						key={`city-${index}`}
						value={order.city}
						column={split ? CUSTOMERS_COLUMN.city : FLAT_COLUMN.city}
						top={split ? customerRowTop : rowTop(index)}
						tone={customerTone(customer)}
						hidden={split && !isFirstOrderOf(customer, index)}
					/>,
				];
			})}

			{customers.map((customer) => (
				<Cell
					key={`customer-key-${customer.id}`}
					value={customer.id}
					column={CUSTOMERS_COLUMN.id}
					top={rowTop(customer.id - 1)}
					tone={phase === 'split' ? 'add' : customerTone(customer)}
					hidden={!split}
				/>
			))}
		</Canvas>
	);
}

function StoredFacts({ input: { orders }, step: { phase } }: NormalizeSceneProps) {
	const split = phase !== 'flat' && phase !== 'repeats';
	const chips: Chip[] = customersOf(orders).map((customer) => ({
		label: `${customer.name} · ${customer.city} ×${split ? 1 : customer.orderCount}`,
		state: phase === 'repeats' && customer.orderCount > 1 ? 'current' : 'plain',
	}));
	return <Chips chips={chips} />;
}

function parseOrders(raw: string): { orders: Order[] } | { error: string } {
	const entries = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
	if (entries.length < 2) return { error: 'Enter at least two orders, separated by commas, e.g. Ana NY pen, Bo LA ink.' };
	if (entries.length > MAX_ORDERS) return { error: `Use ${MAX_ORDERS} orders or fewer so both tables fit on screen.` };

	const orders: Order[] = [];
	for (const entry of entries) {
		const parts = entry.split(/\s+/);
		if (parts.length !== 3) return { error: `"${entry}" needs three words: name, city, item.` };
		if (parts.some((part) => part.length > MAX_VALUE_LENGTH)) return { error: `Keep each word to ${MAX_VALUE_LENGTH} characters or fewer.` };
		const [name, city, item] = parts;
		const earlier = orders.find((order) => order.name === name && order.city !== city);
		if (earlier)
			return {
				error: `${name} has two cities, ${earlier.city} and ${city}. A flat table allows that — it is the anomaly normalization prevents. Give each name one city.`,
			};
		orders.push({ name, city, item });
	}
	return { orders };
}

const makeOrder = (name: string, city: string, item: string): Order => ({ name, city, item });

export default defineExplainer<OrdersInput, NormalizeStep>({
	title: 'Normalize a flat orders table',
	stages: [
		{
			title: 'From one table to two',
			subtitle: 'Customer facts move to their own table; orders point to them by key.',
			Scene: TablesScene,
			Footer: StoredFacts,
		},
	],
	examples: [
		{
			input: { orders: [makeOrder('Ana', 'NY', 'pen'), makeOrder('Ana', 'NY', 'ink'), makeOrder('Bo', 'LA', 'pad'), makeOrder('Ana', 'NY', 'cap')] },
			note: 'One repeat customer',
		},
		{
			input: {
				orders: [
					makeOrder('Ana', 'NY', 'pen'),
					makeOrder('Bo', 'LA', 'ink'),
					makeOrder('Ana', 'NY', 'pad'),
					makeOrder('Bo', 'LA', 'cap'),
					makeOrder('Bo', 'LA', 'mug'),
				],
			},
			note: 'Two repeat customers',
		},
		{
			input: { orders: [makeOrder('Ana', 'NY', 'pen'), makeOrder('Bo', 'LA', 'ink'), makeOrder('Cy', 'SF', 'pad')] },
			note: 'No repeats yet',
		},
	],
	fields: [{ name: 'orders', label: 'orders', placeholder: 'e.g. Ana NY pen, Bo LA ink' }],
	describe: ({ orders }) => `${plural(orders.length, 'order')}: ${orders.map((order) => order.name).join(', ')}`,
	parse(values) {
		const parsed = parseOrders(values.orders);
		return 'error' in parsed ? parsed : { input: parsed };
	},
	steps: buildSteps,
});
