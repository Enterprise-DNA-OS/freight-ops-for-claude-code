---
description: The consignment board. Every piece of freight not yet finished with, in working order, with lateness, runs, DG flags and what each one earns.
---

1. Run `npm run freight -- board`. Add `--customer=` to narrow to one account, `--all` to include delivered history.
2. Read it as the day's working order: picked up first, then assigned, then booked, then held.
3. Call out, in this order: anything past its required date (days late is on the row), anything booked and on no run, anything showing NO RATE (it is moving for $0: `rate add` then `rerate`), and anything on hold with the reason it went there.
4. One consignment's whole story is `npm run freight -- con <ref>`: the lane, the run, the POD, the money, the claims, the notes.
