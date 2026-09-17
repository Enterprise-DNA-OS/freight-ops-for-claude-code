---
description: Cargo claims under the CCLA 2017 carriage of goods rules. Open with the cap stated, decide inside the windows, settle what is accepted.
---

1. Run `npm run freight -- claims` for what is open, `--all` for the history, `claim <no>` for one.
2. Open a claim the day the exception lands: `claim open <con> --kind=damage|loss|shortage --amount= [--units= --desc=]`. The command states the cap: limited carrier's risk is $2,000 per unit (Contract and Commercial Law Act 2017 Part 5) unless the contract says otherwise. A claim over the cap is worth saying early.
3. Decide it inside the Act's windows: `claim decide <no> --accept|--decline --note=`. The note is the record a dispute reads later. Then `claim settle <no> --amount=` when the money moves.
4. The letter to the customer is /draft-claim-response: drafted to `drafts/`, sent by a person.
5. Delivered exceptions with no claim on record show on /attention: chase the customer's intention before the 30 day notice window makes the decision for everyone.
