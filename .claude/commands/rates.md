---
description: The rate cards. The standard tariff, each customer's own lanes, the freight moving with no rate at all, and repricing after a fix.
---

1. Run `npm run freight -- rates` (everything) or `rates <customer>` (their card beside the standard tariff).
2. The gap list is `rate check`: consignments that booked with no matching lane and are moving for $0. Fix the lane (`rate add <from> <to> --rate= [--basis=per_kg|per_pallet|per_item --min= --service= --customer=]`), then `rerate <con>`.
3. A charge already on an invoice never quietly changes: `rerate` refuses billed freight. Credit and re-bill through the accounting system if it was wrong.
4. Rating happens once, at booking, off the card that matched, and the match is written on the consignment. A rate rise prices tomorrow's bookings, not yesterday's.
