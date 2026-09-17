---
description: One consignment in full, resolved by con number, customer ref or receiver name. The lane, the run, the POD, the billing state, claims and notes.
---

1. Run `npm run freight -- con <ref>`. Partial matches resolve; an ambiguous one lists the candidates.
2. Present the card as the story so far: booked when, moving how, delivered against whose signature, billed on which invoice.
3. If it is delivered with no POD, say so first: billing is blocked until `pod <ref> --name=` records the signature that actually exists.
4. If it carries an exception (damage, shortage, refused) with no claim on record, offer to open one: `claim open <ref> --kind= --amount=`.
