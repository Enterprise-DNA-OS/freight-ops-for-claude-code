---
description: Who owes what, aged. Sent invoices past their due date, and the drafts that never went out.
---

1. Run `npm run freight -- debtors`.
2. Worst first: the oldest overdue, then the drafts that never went out (drafted money is not billed money).
3. For each overdue invoice, the move is a call or a letter: draft it with /draft-overdue-letter, a person sends it.
4. The whole exposure picture per customer (owing plus delivered-unbilled, against the limit) is `customers`. An account that keeps promising is a `stop <customer>` conversation for the operator, not for you.
