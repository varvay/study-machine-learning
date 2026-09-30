---
title: Relational modeling
---

A relational database stores data in **tables**. Each row is one record, such as one customer. Each column is one attribute of that record, such as the customer's city.

- **Entity** — a kind of thing the business tracks, such as customer or order. Each entity becomes a table.
- **Primary key** — a column whose value is different in every row, such as `customers.id`. Giving the key picks out exactly one row. It is usually a number the database generates.
- **Foreign key** — a column that holds a primary key of another table. `orders.customer_id = 7` says "this order belongs to customer 7". The database rejects a foreign key that points to no existing row.
- **Join** — a query that combines rows of two tables whose keys match: `orders JOIN customers ON customers.id = orders.customer_id` puts each order next to its customer's name and city.
- **Cardinality** — the number of rows on one side of a relationship that can link to rows on the other side:
  - one-to-one: one user has one profile;
  - one-to-many: one customer has many orders, and each order has one customer;
  - many-to-many: a student takes many courses, and a course has many students. It needs a **join table** such as `enrollments(student_id, course_id)`, where each row pairs one student with one course.

**Normalization** arranges columns so each fact is stored in one place. Changing a fact then means changing one row. The rules are called normal forms. They use one idea: column B **depends on** column A when knowing A tells you B. A customer's id tells you their city, so city depends on customer id.

- **1NF** — every cell holds a single value. A cell `items = "pen, ink"` breaks it: finding every order that contains ink means searching inside text. Store one row per item in an `order_items` table instead.
- **2NF** — 1NF, and every non-key column depends on the whole primary key, never on only part of it. It can only fail when the key has more than one column (a **composite key**). In `order_lines(order_id, product_id, quantity, product_name)`, the key is the pair `(order_id, product_id)`. `quantity` depends on the whole pair, but `product_name` depends on `product_id` alone, so it moves to a `products` table.
- **3NF** — 2NF, and no non-key column depends on another non-key column. In `orders(id, customer_id, customer_city)`, the city depends on `customer_id`, not on the order's `id`, so it moves to `customers`. The walkthrough below shows this split.

**Denormalization** copies a fact into more than one table on purpose, such as keeping `customer_city` on `orders`. A read skips a join and gets faster. A change of city must now update every copy, and a missed copy leaves the data contradicting itself.
