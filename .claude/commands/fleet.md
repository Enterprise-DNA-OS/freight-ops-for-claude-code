---
description: The trucks and their clocks. COF, rego, RUC licence distance against the hubodometer, payloads. What stops a truck legally before it stops mechanically.
---

1. Run `npm run freight -- fleet`. One truck in full: `vehicle <fleet-no>`.
2. Three clocks per vehicle, and any of them stops the truck: COF (six-monthly on heavy vehicles), rego, and the RUC licence distance against the hubodometer (Road User Charges Act 2012: driving past the licence is an offence).
3. Keep the clocks honest as things happen: `vehicle cof <fleet> --done=` after the inspection, `vehicle rego <fleet> --due=` off the new label, `vehicle ruc <fleet> --to-km=` when the next block is bought, `vehicle hubo <fleet> <km>` with each reading.
4. LOW on RUC (under 1,000 km of headroom) means buy the block this week, before the truck earns an assessment.
