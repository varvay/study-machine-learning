---
title: Transactions and isolation
---

Recap (G1.3 L1): a transaction is all-or-nothing, and its isolation level sets how much of other transactions' work it can see. Here you reproduce each anomaly in two `psql` sessions (`psql` is PostgreSQL's command-line client) and learn the tools that prevent it.

**Choosing a level.** PostgreSQL's default is Read Committed. Set another level per transaction, before its first query:

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ;
-- or, as the first statement after BEGIN:
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SHOW transaction_isolation;
```

`SET TRANSACTION` after a query fails with `SET TRANSACTION ISOLATION LEVEL must be called before any query`. In Spring, the Java application framework, `@Transactional(isolation = Isolation.REPEATABLE_READ)` does the same per method.

**How the levels differ in PostgreSQL.** Every level reads from a **snapshot**: the set of transactions committed at one moment. Uncommitted changes of other transactions are never in it.

- **Read Committed** takes a new snapshot for each statement, so each statement sees everything committed before it began.
- **Repeatable Read** takes one snapshot at the transaction's first statement and keeps it to the end. If it tries to change a row that another transaction changed after that snapshot, it fails.
- **Serializable** is Repeatable Read plus tracking of what each transaction read. It fails a transaction whose reads and writes, combined with others', match no one-at-a-time order.
- **Read Uncommitted** behaves exactly like Read Committed.

**Reproduce them.** Open two terminals, each running `psql`, called session A and session B below. Create the data once:

```sql
CREATE TABLE accounts (id text PRIMARY KEY, balance int NOT NULL, version int NOT NULL DEFAULT 1);
INSERT INTO accounts VALUES ('A', 100);
CREATE TABLE doctors (name text PRIMARY KEY, on_call boolean NOT NULL);
INSERT INTO doctors VALUES ('alice', true), ('bob', true);
```

Start each run with `BEGIN ISOLATION LEVEL …;` in both sessions, then run the statements in the order of the table rows. Reset the data between runs. Every result below was checked on PostgreSQL 14.

**Dirty read** — reading a change another transaction has not committed. If that transaction rolls back, the reader acted on a value that never existed.

| Session A | Session B |
|---|---|
| `SELECT balance FROM accounts WHERE id = 'A';` → 100 | |
| | `UPDATE accounts SET balance = 20 WHERE id = 'A';` |
| `SELECT balance FROM accounts WHERE id = 'A';` → **100** | |
| | `ROLLBACK;` |

A never sees 20, at any level. The SQL standard allows the dirty read at Read Uncommitted; PostgreSQL does not.

**Non-repeatable read** — reading the same row twice in one transaction and getting different values, because another transaction changed it and committed in between.

| Session A | Session B |
|---|---|
| `SELECT balance FROM accounts WHERE id = 'A';` → 100 | |
| | `UPDATE accounts SET balance = 20 WHERE id = 'A';` |
| | `COMMIT;` |
| `SELECT balance FROM accounts WHERE id = 'A';` → **20** at Read Committed, **100** at Repeatable Read | |

It matters when a transaction computes from several reads, such as a report whose total was summed before a change and whose detail rows were read after it.

**Phantom read** — running the same search twice and getting a different set of rows, because another transaction inserted or deleted matching rows and committed in between. It differs from a non-repeatable read in that no row A already read has changed; the set of rows has.

| Session A | Session B |
|---|---|
| `SELECT count(*) FROM doctors WHERE on_call;` → 2 | |
| | `INSERT INTO doctors VALUES ('carol', true);` |
| | `COMMIT;` |
| `SELECT count(*) FROM doctors WHERE on_call;` → **3** at Read Committed, **2** at Repeatable Read | |

**Lost update** — two transactions read the same value, each computes a new value from it, and the second write overwrites the first. Here each session withdraws 80 after checking that the balance covers it:

| Session A | Session B |
|---|---|
| `SELECT balance FROM accounts WHERE id = 'A';` → 100 | |
| | `SELECT balance FROM accounts WHERE id = 'A';` → 100 |
| `UPDATE accounts SET balance = 20 WHERE id = 'A';` | |
| | `UPDATE accounts SET balance = 20 WHERE id = 'A';` → waits for A's row lock (an `UPDATE` locks each row it changes until its transaction ends) |
| `COMMIT;` | |
| | Read Committed: `UPDATE 1`, then `COMMIT` succeeds. **160 paid out, balance 20.** |
| | Repeatable Read: `ERROR: could not serialize access due to concurrent update` |

**Write skew** — two transactions read the same data, each checks a rule, then each updates a *different* row. Each write keeps the rule alone; together they break it. Rule: at least one doctor stays on call.

| Session A | Session B |
|---|---|
| `SELECT count(*) FROM doctors WHERE on_call;` → 2 | |
| | `SELECT count(*) FROM doctors WHERE on_call;` → 2 |
| `UPDATE doctors SET on_call = false WHERE name = 'alice';` | |
| | `UPDATE doctors SET on_call = false WHERE name = 'bob';` |
| `COMMIT;` | |
| | `COMMIT;` → succeeds at Read Committed and Repeatable Read: **0 on call**. At Serializable: `ERROR: could not serialize access due to read/write dependencies among transactions` |

Repeatable Read cannot catch it: the two transactions wrote different rows, so no row was changed by both.

**Which PostgreSQL level prevents which anomaly.** The first three columns follow the table in the PostgreSQL docs; lost update and write skew are the two runs above.

| Level | Dirty read | Non-repeatable read | Phantom read | Lost update | Write skew |
|---|---|---|---|---|---|
| Read Uncommitted | prevented (standard allows it) | possible | possible | possible | possible |
| Read Committed | prevented | possible | possible | possible | possible |
| Repeatable Read | prevented | prevented | prevented (standard allows it) | prevented, with an error | possible |
| Serializable | prevented | prevented | prevented | prevented, with an error | prevented, with an error |

The walkthrough below plays these timelines step by step at the level you choose.

**Retry on serialization failure.** "Prevented, with an error" means PostgreSQL aborts one transaction, and the application must run it again from `BEGIN`. The retry reads the new data and decides again: B's retry reads 20 and refuses the withdrawal. Every such error carries SQLSTATE (the SQL standard's five-character error code) `40001`, so retry on that code, a few times at most:

```java
import java.sql.Connection;
import java.sql.SQLException;
import javax.sql.DataSource;

final class Transactions {
    private static final String SERIALIZATION_FAILURE = "40001";
    private static final int MAX_ATTEMPTS = 3;

    @FunctionalInterface
    interface TransactionWork<T> {
        T run(Connection connection) throws SQLException;
    }

    static <T> T inRepeatableRead(DataSource dataSource, TransactionWork<T> work) throws SQLException {
        for (int attempt = 1; ; attempt++) {
            try (Connection connection = dataSource.getConnection()) {
                connection.setAutoCommit(false);
                connection.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
                try {
                    T result = work.run(connection);
                    connection.commit();
                    return result;
                } catch (SQLException failure) {
                    connection.rollback();
                    boolean retryable = SERIALIZATION_FAILURE.equals(failure.getSQLState());
                    if (!retryable || attempt == MAX_ATTEMPTS) throw failure;
                }
            }
        }
    }
}
```

The whole unit of work goes inside `work`, reads included: a retry that reused values read in the failed attempt would repeat the anomaly.

**Preventing lost updates at Read Committed.** Raising the level is one fix; three others keep the default level.

1. **Do the arithmetic in the `UPDATE`.** An `UPDATE` that waited for a row lock re-checks its `WHERE` against the newly committed row, so the check and the write happen together:

   ```sql
   UPDATE accounts SET balance = balance - 80 WHERE id = 'A' AND balance >= 80;
   ```

   In the lost-update race, B's statement waits for A, then finds `balance = 20`, and reports `UPDATE 0`: no row changed, so the application refuses the withdrawal.

2. **Pessimistic locking with `SELECT … FOR UPDATE`.** `FOR UPDATE` locks the rows the `SELECT` returns until the transaction ends. Another transaction's `FOR UPDATE`, `UPDATE`, or `DELETE` on those rows waits; plain `SELECT`s still read them.

   | Session A | Session B |
   |---|---|
   | `SELECT balance FROM accounts WHERE id = 'A' FOR UPDATE;` → 100 | |
   | | `SELECT balance FROM accounts WHERE id = 'A' FOR UPDATE;` → waits |
   | `UPDATE accounts SET balance = 20 WHERE id = 'A';` | |
   | `COMMIT;` | |
   | | → **20**: B sees A's withdrawal and refuses its own |

   Use it when conflicts are frequent and the locked section is short. Lock rows in a consistent order (for example by id) so two transactions never wait on each other in a circle, which is a deadlock (G1.3 L3).

3. **Optimistic locking with a version column.** Read the row with its `version`, and make the write succeed only if the version is unchanged:

   ```sql
   SELECT balance, version FROM accounts WHERE id = 'A';                 -- 100, version 1
   UPDATE accounts SET balance = 20, version = version + 1
   WHERE id = 'A' AND version = 1;
   ```

   The first writer gets `UPDATE 1`; the second gets `UPDATE 0` because the version is now 2. On `UPDATE 0`, re-read and retry, or report a conflict to the user. Nothing waits and no lock is held between the read and the write, so it suits conflicts that are rare, or a read and a write separated by user think time, such as an edit form. JPA (Jakarta Persistence, Java's standard API for mapping objects to tables) does this for you with a field annotated `@Version`: it adds the version check to every update and throws `OptimisticLockException` when no row matched (Spring translates it to `ObjectOptimisticLockingFailureException`).

**Preventing write skew below Serializable.** Lock the rows the rule reads, not only the row you write:

```sql
SELECT name FROM doctors WHERE on_call FOR UPDATE;   -- count the rows in the application
```

`FOR UPDATE` cannot be combined with `count(*)` (`FOR UPDATE is not allowed with aggregate functions`), so select the rows and count them. At Read Committed, B's `SELECT` waits for A, then returns only `bob`: one doctor left, so Bob stays. This works when the rows to lock already exist. When the rule concerns rows that may be inserted, such as "no two bookings overlap", no existing row can be locked; use Serializable or a constraint.

Sources: [PostgreSQL — Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html) · [PostgreSQL — Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html) · [PostgreSQL — SELECT, the locking clause](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE) · [PostgreSQL — SET TRANSACTION](https://www.postgresql.org/docs/current/sql-set-transaction.html) · [Spring — `Isolation`](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/annotation/Isolation.html) · [Jakarta Persistence — `@Version`](https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/version) · [Spring — `ObjectOptimisticLockingFailureException`](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/orm/ObjectOptimisticLockingFailureException.html)
