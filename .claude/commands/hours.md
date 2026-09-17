---
description: Driver work time, day by day, breaches flagged. The record the logbook rules read - 5.5h continuous then a break, 13h in a work day.
---

1. Run `npm run freight -- hours` (14 days), or `driver <name>` for one person's fortnight and recent runs.
2. The flags are the law, not preferences: OVER 13H is past the cumulative work day limit; NO BREAK 5.5H+ is a run past the continuous work limit with no recorded rest (Land Transport Rule: Work Time and Logbooks 2007).
3. A break that was taken but never recorded backfills honestly: `run break <run> <minutes>`. A genuine breach is fixed in the roster, not in the record: say what happened and what changes.
4. Depart, return and break minutes are captured on each run (`run depart`, `run return --break=`). These rows are what an inspector, an insurer, or a coroner reads.
