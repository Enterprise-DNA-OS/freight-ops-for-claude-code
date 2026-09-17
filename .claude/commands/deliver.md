---
description: The delivery flow. Pick up, deliver against a signed POD, record exceptions at the door honestly, backfill signatures that turn up later.
---

1. `npm run freight -- pickup <con>` when it is on the truck.
2. `npm run freight -- deliver <con> --pod="R. Aporo" [--at=]` when it lands. The POD name comes off the paperwork or the app; never invent one. A genuinely unsigned drop (authority to leave, closed dock) is `--no-pod`, which records the gap loudly instead of quietly.
3. Damage, shortage or refusal at the door goes on the record at delivery: `--exception=damage --note="what the receiver said"`. That row feeds DIFOT and the claims process; softening it helps nobody.
4. A signature that turns up later: `pod <con> --name= [--at=]`. The consignment can bill the moment it lands.
5. The chase list is `/pods`: every delivered consignment with no POD, oldest first, with the blocked dollars beside it.
