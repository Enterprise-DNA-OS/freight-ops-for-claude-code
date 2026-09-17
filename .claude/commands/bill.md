---
description: The billing run. Drafts one invoice per customer for delivered POD-backed freight, consignment lines plus the fuel levy, due off the account terms. Nothing sends.
---

1. Preview first: `npm run freight -- bill --dry-run` (or `bill <customer> --dry-run` for one account).
2. If it looks right: `npm run freight -- bill`. One draft invoice per customer: a line per consignment, the fuel levy on its own line, due date off the account's terms.
3. Freight with no POD does not bill and the command says how much is blocked: that is `/pods` work, not an override.
4. Render the paperwork in the company's brand: `npm run docs -- invoice`. A person checks it and sends it from their own system, then `invoice sent <number>`, and `invoice paid <number>` when the money lands.
5. `debtors` shows what is out and aging. Chasing letters are drafted (/draft-overdue-letter), never sent from here.
