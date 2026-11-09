---
title: Relational modeling
---

Recap (G1.1 L1): entities become tables, keys link them, and the normal forms put each fact in one place. Here you take one flat spreadsheet to a constrained PostgreSQL schema.

**The starting point.** A shop tracks orders in one sheet, one row per order line:

| order_id | ordered_on | customer_email | customer_name | customer_city | product_sku | product_name | unit_price | quantity |
|---|---|---|---|---|---|---|---|---|
| 1042 | 2026-09-01 | ana@example.com | Ana | Jakarta | PEN-01 | Gel pen | 2.50 | 3 |
| 1042 | 2026-09-01 | ana@example.com | Ana | Jakarta | INK-07 | Blue ink | 4.00 | 1 |
| 1043 | 2026-09-02 | budi@example.com | Budi | Bandung | PEN-01 | Gel pen | 2.50 | 10 |

Ana's city is stored twice and "Gel pen" twice. Changing either means finding every copy.

**Normalize it to 3NF**, one normal form at a time:

1. **1NF** — every cell holds one value. The sheet already has one product per row, so it passes. A sheet with `products = "PEN-01, INK-07"` would first be split into one row per product.
2. **2NF** — find the key, then move every column that depends on only part of it. The key of a row is `(order_id, product_sku)`, where the SKU (stock-keeping unit) is the product's code: neither alone picks out one row. `quantity` needs both. `ordered_on` and the customer columns depend on `order_id` alone, so they move to `orders`. `product_name` depends on `product_sku` alone, so it moves to `products`.
3. **3NF** — move every column that depends on another non-key column. In the new `orders`, `customer_name` and `customer_city` depend on `customer_email`, not on the order, so they move to `customers`, and `orders` keeps a foreign key to it.

`unit_price` stays on the order line as well as on `products`. The two are different facts: `products.unit_price` is today's price, `order_items.unit_price` the price the customer paid. Copying today's price onto old orders would be wrong the day the price changes.

**Draw the ERD.** An **entity-relationship diagram (ERD)** is a picture of the tables, their columns, and the foreign keys between them, drawn to agree on the design before writing DDL (data definition language: the `CREATE TABLE` statements that define the schema). Line ends show cardinality, usually in crow's-foot notation: a bar means one, a three-pronged foot means many. Two common tools:

- **dbdiagram.io** — you type the schema in DBML, a small text language, and it draws the diagram and exports PostgreSQL DDL. Because the schema is text, it can live in Git.
- **draw.io** (diagrams.net) — a free drag-and-drop editor; you draw the boxes and lines by hand.

The shop in DBML (`>` means many-to-one):

```text
Table customers {
  id bigint [pk, increment]
  email text [not null, unique]
  name text [not null]
  city text [not null]
}

Table products {
  sku text [pk]
  name text [not null]
  unit_price decimal(10,2) [not null]
}

Table orders {
  id bigint [pk]
  customer_id bigint [not null]
  ordered_on date [not null]
}

Table order_items {
  order_id bigint [not null]
  product_sku text [not null]
  quantity int [not null]
  unit_price decimal(10,2) [not null]
  indexes {
    (order_id, product_sku) [pk]
  }
}

Ref: orders.customer_id > customers.id [delete: restrict]
Ref: order_items.order_id > orders.id [delete: cascade]
Ref: order_items.product_sku > products.sku [delete: restrict]
```

**Write the DDL** with the constraints that make bad data impossible to store:

```sql
CREATE TABLE customers (
  id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name  text NOT NULL,
  city  text NOT NULL
);

CREATE TABLE products (
  sku        text PRIMARY KEY,
  name       text NOT NULL,
  unit_price numeric(10, 2) NOT NULL CHECK (unit_price >= 0)
);

CREATE TABLE orders (
  id          bigint PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  ordered_on  date   NOT NULL
);

CREATE TABLE order_items (
  order_id    bigint NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_sku text   NOT NULL REFERENCES products (sku) ON DELETE RESTRICT,
  quantity    int    NOT NULL CHECK (quantity > 0),
  unit_price  numeric(10, 2) NOT NULL CHECK (unit_price >= 0),
  PRIMARY KEY (order_id, product_sku)
);

CREATE INDEX orders_customer_id ON orders (customer_id);
CREATE INDEX order_items_product_sku ON order_items (product_sku);
```

- **`NOT NULL`** — the column must hold a value. Without it, any column accepts `NULL`, meaning unknown.
- **`UNIQUE`** — no two rows share the value. PostgreSQL treats two `NULL`s as different, so a nullable unique column accepts many `NULL`s; add `NULLS NOT DISTINCT` (PostgreSQL 15+) to allow only one.
- **`CHECK (expression)`** — the row is rejected when the expression is false. A `NULL` result passes, so pair `CHECK` with `NOT NULL` when the value is required.
- **`GENERATED ALWAYS AS IDENTITY`** — the database numbers new rows itself; it is the standard-SQL form of `serial`, PostgreSQL's older auto-numbering type.
- **Foreign key (`REFERENCES`)** — the value must exist as a key in the other table. PostgreSQL does not index the referencing column for you; index it, or every delete on the parent scans the child table and joins on it run slowly. The two `CREATE INDEX` lines above do that. (`order_items.order_id` needs no index of its own: it is the first column of the primary key's index, see G1.2.)

**`ON DELETE` rules** decide what happens to child rows when their parent row is deleted:

| Rule | Effect | Use it when |
|---|---|---|
| `NO ACTION` (default) | the delete fails if children remain, checked at the end of the statement, or at commit if the constraint is deferred | the default is fine |
| `RESTRICT` | the delete fails at once, and the check cannot be deferred | the child is a record that must survive: an order keeps its customer |
| `CASCADE` | the children are deleted too | the child has no meaning alone: an order line without its order |
| `SET NULL` | the child's foreign key becomes `NULL` | the link is optional: a ticket whose assignee leaves |
| `SET DEFAULT` | the child's foreign key takes its default value | the link falls back to a known row, such as an "unassigned" user |

**Move the data** from the sheet (loaded as `orders_flat`) into the new tables. Parents go first, so every foreign key finds its row:

```sql
INSERT INTO customers (email, name, city)
SELECT DISTINCT customer_email, customer_name, customer_city FROM orders_flat;

INSERT INTO products (sku, name, unit_price)
SELECT DISTINCT product_sku, product_name, unit_price FROM orders_flat;

INSERT INTO orders (id, customer_id, ordered_on)
SELECT DISTINCT f.order_id, c.id, f.ordered_on
FROM orders_flat f
JOIN customers c ON c.email = f.customer_email;

INSERT INTO order_items (order_id, product_sku, quantity, unit_price)
SELECT order_id, product_sku, quantity, unit_price FROM orders_flat;
```

A failing insert here is a finding about the data. If one SKU appears at two prices, `SELECT DISTINCT` returns two rows for it and the primary key on `products` rejects the second. If Ana's city is spelled two ways, she becomes two rows and the `UNIQUE` on `email` rejects one. Clean the sheet, or decide which value wins, then rerun.

The constraints then guard the data. On PostgreSQL 14, `DELETE FROM customers WHERE email = 'budi@example.com'` fails with `violates foreign key constraint "orders_customer_id_fkey"`, deleting order 1043 removes its line with it, and a line with `quantity = 0` fails with `violates check constraint "order_items_quantity_check"`.

Sources: [PostgreSQL — Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html) · [PostgreSQL — CREATE TABLE](https://www.postgresql.org/docs/current/sql-createtable.html) · [DBML docs](https://dbml.dbdiagram.io/docs/) · [draw.io](https://www.drawio.com/)
