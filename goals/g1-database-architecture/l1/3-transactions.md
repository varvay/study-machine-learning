---
title: Transactions and ACID
---

A **transaction** is a group of statements that the database treats as one unit. It starts with `BEGIN` and ends with `COMMIT`, which makes every change permanent, or `ROLLBACK`, which undoes every change.

Example: move 100 from account A to account B.

```sql
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 'A';
UPDATE accounts SET balance = balance + 100 WHERE id = 'B';
COMMIT;
```

ACID names four guarantees a transaction gets:

- **Atomicity** — the statements in the transaction all take effect, or none of them does. If the server crashes after the debit from A but before the credit to B, the database undoes the debit on restart. The 100 is never lost halfway.
- **Consistency** — a transaction may only move the data from one valid state to another. "Valid" means every rule declared in the schema still holds: primary keys unique, foreign keys pointing to real rows, checks such as `balance >= 0`. A transaction that would break a rule fails and is rolled back.
- **Isolation** — transactions running at the same time do not see each other's uncommitted changes. While the transfer runs, another query sees A and B either both before the transfer or both after it, never A debited with B not yet credited.
- **Durability** — once `COMMIT` returns, the change survives a crash or power loss. The database writes each change to a log on disk, the write-ahead log, before it confirms the commit, and replays that log on restart.

**Isolation levels** set how much of other transactions' work a transaction can see. Weaker isolation lets more transactions run in parallel but allows **anomalies**: wrong results caused by interleaving. For example, two withdrawals of 80 each read a balance of 100 and each write back 20: the account paid out 160 but shows 20.

| Level | A transaction sees |
|---|---|
| Read Uncommitted | may see other transactions' uncommitted changes (PostgreSQL treats it as Read Committed) |
| Read Committed | each statement sees only data committed before that statement began — PostgreSQL's default |
| Repeatable Read | the whole transaction sees one snapshot, taken when it began |
| Serializable | results as if the transactions had run one after another |

Source: [PostgreSQL — Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
