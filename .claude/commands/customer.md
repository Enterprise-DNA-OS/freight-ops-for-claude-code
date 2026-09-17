---
description: One account's whole relationship. Exposure against the limit, DIFOT, recent freight, invoices, claims, notes and open tasks on one card.
---

1. Run `npm run freight -- customer <name>`. The full list ranked by exposure is `customers`.
2. Exposure is owing plus delivered-unbilled freight, and it is the number the credit limit is judged against, not the statement balance.
3. Credit holds are `stop <name>` and `unstop <name>`: a stopped account cannot book, and the refusal is the policy working. The stop and the release are both the operator's call, made in this session.
4. Before drafting anything for a customer, read this card first: the notes and the claims are the context that stops a tone-deaf email.
