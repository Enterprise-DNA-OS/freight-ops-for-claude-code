---
description: One run's day. The manifest in drop order, depart and return with the break recorded, and the work time warning when the day breaches.
---

1. The manifest: `npm run freight -- run <ref>`.
2. The day itself: `run depart <ref> [--at=]` when it leaves, `run return <ref> [--at= --break=]` when it lands. Record the break minutes honestly: those rows are the work time record an inspector reads (Work Time and Logbooks Rule 2007).
3. A break that was taken but never recorded backfills with `run break <ref> <minutes>`. A day genuinely over the limits is reported, not edited: say it plainly and fix the roster forward.
4. Drops are `pickup <con>` and `deliver <con> --pod="Name"` as they happen, or all at once when the paperwork comes back.
