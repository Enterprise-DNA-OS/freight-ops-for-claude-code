# Moving off TransVirtual

One command brings the business across: customers, the consignment history with its PODs, and the rate cards. This page says which exports to make, what maps where, and what deliberately does not come over.

## What you pay TransVirtual for, structurally

TransVirtual is priced per consignment moved: every piece of freight you cart carries a software fee on top of the diesel and the driver, and the modules around it (POD, invoicing, rate management, integrations) are configured as a project. Leaving it does not touch your accounting system: that stays exactly where it is, and this repo drafts invoices for a person to send and reconcile there, the same as before.

## Step 1: export from TransVirtual

TransVirtual's grids and reports export to CSV. Make three files:

1. **Customers.** The customer or account list: Customer, Customer Code, Contact, Email, Phone, Suburb, Payment Terms.
2. **Consignments.** The consignment report over the date range you want to keep (a year is plenty): Connote, Customer, Receiver, Receiver Address, From Zone, To Zone, Service, Items, Pallets, Weight, Booked Date, Required Date, Delivered Date, POD Name, Freight Charge.
3. **Rates.** The rate card report: Customer (blank for the standard tariff), From Zone, To Zone, Service, Basis, Rate, Min.

Column names do not need to match exactly: the importer reads the common variants (`Connote` or `Consignment Number`, `Receiver` or `Deliver To`, `Weight` or `Total Weight`, and so on), and dates in DD/MM/YYYY come in correctly.

## Step 2: dry run, then run

```bash
npm run freight -- import transvirtual --customers=customers.csv --consignments=consignments.csv --rates=rates.csv --dry-run
npm run freight -- import transvirtual --customers=customers.csv --consignments=consignments.csv --rates=rates.csv
```

The dry run prints exactly what would be created, updated and skipped, and writes nothing. Import customers before (or with) consignments, or the consignments skip with a message saying so. Re-running is safe: existing records update instead of duplicating, keyed on the connote numbers and names.

## What maps

| TransVirtual | Here |
|---|---|
| Customers, codes, contacts, terms | `customers` |
| Consignments with their lanes, weights and dates | `consignments` (delivered history lands `delivered`, open freight lands `booked`) |
| POD names and delivery dates | on the consignment, so "we never got it" still has its answer |
| Freight charges as invoiced | `charge_cents`, marked as imported |
| Rate cards, standard and per customer | `rate_cards` |
| History by customer | on the customer card the moment it lands |

## What deliberately does not come over

- **Runs and work time records.** The old system's says-so is not a logbook position. Drivers book their days here from cutover morning (`run create`, `run depart`, `run return --break=`), and `/compliance` reads only what was actually recorded.
- **The fleet clocks.** Walk the yard once with the paperwork: the COF label on each windscreen, the rego label, the RUC licence and the hubodometer reading. `add vehicle` takes all of it. Most operators find at least one clock closer to zero than they thought, which is the argument for the walk.
- **Driver endorsements.** The D endorsement comes off each licence, sighted, not off a software field. `add driver --dg` records it.
- **Claims.** Old claims stay in the old system's history and your files. Claims here start from cutover, decided inside the Act's windows from day one.
- **Invoices and the ledger.** Your accounting system keeps every invoice TransVirtual ever generated. Nothing here rewrites history; new invoices are drafted here and sent by a person, same as always.
- **Sign-on-glass images.** The POD names and dates import; the signature images stay in your TransVirtual archive or your own storage. New PODs recorded here are names and times; images live where your team already puts them, referenced in the notes.

## Cutover, in practice

1. Import on a Friday. Dry run, run, then read `board`, `customers` and `rates` back and spot-check ten consignments against TransVirtual.
2. Walk the yard over the weekend: fleet clocks off the actual labels and licences (`add vehicle`), endorsements off the actual licences (`add driver`).
3. Run `rate check` and price any lane that shows NO RATE before Monday's bookings hit it.
4. Monday morning, the office books here (`book`), the runs are built here (`run create`, `assign`), drivers' days are recorded here, and `/attention` runs at smoko.
5. Run both systems in parallel for one billing cycle if it helps the office sleep; the export is always there (`export` dumps everything to JSON).
