---
description: DIFOT per customer, last 28 days. Delivered in full (no exception at the door) and on time (against the required date), from the delivery record.
---

1. Run `npm run freight -- difot`, or `difot <customer>` for one account.
2. On time is measured against the required-by date on the booking; in full means no damage, shortage or refusal at the door. Both come from the record, not from memory.
3. For any customer under target, pull the misses: `con <ref>` on each late or excepted delivery tells the story (which run, which driver, what happened).
4. The customer-facing version renders with `npm run docs -- service-report`: the same numbers, in the company's brand, one file per customer. Check it before anyone sends it.
