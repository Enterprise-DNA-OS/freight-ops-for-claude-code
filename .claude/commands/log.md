---
description: Conversations and decisions onto the record, against a customer or a consignment. The disputes read it later.
---

1. Run `npm run freight -- log "what was said or decided" --customer=<name>` or `--con=<ref>`.
2. Log the things a dispute or a handover would need: payment promises, claim conversations, agreed rate changes, why a hold went on.
3. Follow-ups become tasks: `task add "chase the July account" --customer= --due=`. `tasks` lists what is open; overdue ones surface on /attention.
