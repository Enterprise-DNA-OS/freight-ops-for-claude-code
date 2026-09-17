---
description: Bring the business across from TransVirtual, or any transport system that exports CSV. Customers, consignments with their PODs, and rate cards, idempotently.
---

1. Read `docs/replace-transvirtual.md` first: which exports to make, what maps, what deliberately does not come over.
2. Dry run, always: `npm run freight -- import transvirtual --customers=customers.csv --consignments=consignments.csv --rates=rates.csv --dry-run`. It prints exactly what would be created and updated, and writes nothing.
3. Then the real run, same flags without `--dry-run`. Customers land before consignments or the consignments skip with a message saying so. Delivered history lands delivered with its PODs; open freight lands booked. Re-running updates instead of duplicating.
4. After import: `board`, `customers` and `rates` to spot-check ten records against the old system, then `rerate` anything that shows NO RATE.
5. Runs, work time records and claims start from cutover day, deliberately: the old system's says-so is not a record. The replace doc says why.
