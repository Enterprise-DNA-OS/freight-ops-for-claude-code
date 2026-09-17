---
description: The run board. Every run with its driver, truck, stops, load against the rated payload, DG flag and the day's work time span.
---

1. Run `npm run freight -- runs` (last week and ahead), `--date=` for one day, `--all` for everything.
2. Call out any run over 100% of payload (it does not leave like that), any run carrying DG (check the driver's endorsement on the row), and any done run showing NO BREAK.
3. One run's manifest, in drop order: `npm run freight -- run <ref>`. Print it for the driver with `npm run docs -- run-sheet`.
4. Build tomorrow: `run create --date= --driver= --vehicle= --name=`, then `assign <con> <run>` for each drop. The DG and payload gates apply at assignment, which is the cheapest place to fail.
