---
description: Book a consignment. Rates it off the customer's card or the standard tariff at booking, refuses stopped accounts, flags unpriced lanes loudly.
---

1. Gather what the phone call or the email gives you: customer, from and to zones, weight or pallets, service, receiver, required date, any dangerous goods.
2. Run `npm run freight -- book <customer> --from-zone= --to-zone= --weight= [--pallets= --items= --service= --receiver= --dest-address= --required= --ref= --dg --dg-class= --instructions=]`.
3. The charge comes off the rate cards the moment it books: the customer's own card wins over the standard tariff. Say the charge back so the operator can hear a wrong rate now, not at invoicing.
4. Refusals are the system working: a stopped account does not book (escalate to the operator), and an unpriced lane books at $0 with a loud flag (fix with `rate add` then `rerate`).
5. Dangerous goods need `--dg --dg-class=`: the class drives the D endorsement gate at assignment.
6. Then put it on a run: `assign <con> <run>`.
