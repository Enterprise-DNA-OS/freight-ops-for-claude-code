---
description: The chasing letter for an overdue invoice, written from the record, into drafts/. Never sent from here.
---

1. Run `npm run freight -- invoice <number> --json` and `customer <name>` for the history: the deliveries behind the invoice, the PODs, the promises already logged.
2. Write the letter to `drafts/overdue-<number>.md`: the invoice number and date, what it covered (the consignments and their signed PODs are the answer to "we never got it"), the amount, the days overdue, and the ask with a date.
3. Match the tone to the aging: a first nudge reads differently from a 60-day letter. Reference any logged promise by its date.
4. Tell the operator the draft is ready and where. A person sends it. Never send anything from here.
