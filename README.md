<h1 align="center">Freight Ops for Claude Code</h1>

<p align="center">
  <strong>The open-source freight and transport operations system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Or installed and run for you.
</p>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#compliance-checked-against-the-data">Compliance</a> &bull;
  <a href="#ten-questions-transvirtual-cannot-answer">Ten questions</a> &bull;
  <a href="#instead-of-transvirtual">Instead of TransVirtual</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Freight Ops for Claude Code does the job you pay TransVirtual for, as a Postgres database and a set of Claude Code commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) and ask for what you want in plain language. It runs the right query, and it can answer questions the vendor's report menu cannot.

It is built for a general freight carrier: the consignments from booking to signed POD, the runs and the drivers' work time, the trucks with their COF, rego and RUC clocks, the rate cards that price each booking the day it is made, the invoice run that bills delivered POD-backed freight with the fuel levy on its own line, and the cargo claims decided inside the Act's windows. The words are the words a freight office already uses.

**Nothing sends, pays or talks to an accounting system on its own.** Invoices are drafted here and a person sends them; your accounting system keeps the ledger. The gates are real, though: freight with no signed POD does not bill, dangerous goods do not ride with an unendorsed driver, and no run leaves over its rated payload.

```
/attention                        everything that wants a decision, worst first
/board                            every open consignment: late, stuck, unrated, held
/runs                             the runs: stops, load against payload, DG, work time
/pods                             delivered with no signed POD: billing blocked, chase list
/bill                             draft invoices for delivered POD-backed freight
/difot                            delivered in full, on time, per customer, from the record
/hours                            driver work time against the logbook rules
/fleet                            COF, rego and RUC clocks on every truck
/claims                           cargo claims with the CCLA cap stated
/compliance                       six rules from the Acts and the Rules, run against your records
/weekly-review                    the Monday review, written from three commands
```

The board, the billing, DIFOT and the attention list all read the same views over the same tables, so they can never disagree with each other. Charges are rated onto each consignment at booking, off the card that matched, so a rate change never reprices booked freight.

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your data sits in plain Postgres tables you own. Any tool can read them. No export request, no API project, no access ending when a subscription does.
- No per-consignment fee, no modules, no implementation project. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/freight-ops-for-claude-code.git
cd freight-ops-for-claude-code
npm install
npm run demo
```

`npm run demo` creates the database and loads Tui Freight Lines, a demo Palmerston North carrier with 27 consignments and its problems showing: three deliveries with no signed POD (the oldest nine days), $1,514 of POD-backed freight on no invoice, class 3 dangerous goods on today's metro run with an unendorsed driver, the same run loaded 8,450 kg on a truck rated 8,000, a COF eight days overdue, 400 km left on a RUC licence, a six-hour run with no recorded break, a $1,850 damage claim undecided for 19 days, and a customer over its credit limit.

Then open the folder in Claude Code and type:

```
/attention
```

Try `/board`, `/runs`, `/pods`, `/difot`, `/fleet`, `con CON-1314`. When you are ready for real data, delete `.data/` and start with `/import`, or add records one at a time with `add customer`, `add driver`, `add vehicle`.

Fill in the "Who this is for" block in [CLAUDE.md](CLAUDE.md) so drafts come out in your company's voice, and put your name and colours in [brand.json](brand.json) so the invoices, con notes, run sheets and service reports carry them.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee. The office, the depot and the owner each clone the repo, point at the same `DATABASE_URL`, and work in their own Claude Code.

## The commands

| Command | What it does |
|---|---|
| `/attention` | Everything that wants a decision, worst first: DG with the wrong driver, overloaded runs, work time breaches, expiring certificates, missing PODs, money asleep. |
| `/board` | Every open consignment: days late against the required date, what is stuck on no run, what booked with no rate, what is held and why. |
| `/con` | One consignment's whole story: the lane, the run, the POD, the billing state, claims and notes. |
| `/book` | Book freight in. Rated off the customer's card or the standard tariff at booking; stopped accounts refuse; unpriced lanes flag loudly. |
| `/runs` | The run board: stops, load against the truck's rated payload, DG flags, the day's span and breaks. |
| `/run` | One run's manifest in drop order; depart, return and the break recorded honestly. |
| `/deliver` | Pick up, deliver against a signed POD, record exceptions at the door as the receiver said them. |
| `/pods` | Delivered freight with no signed POD, oldest first, with the blocked dollars beside it. Billing waits on every row. |
| `/bill` | One draft invoice per customer for delivered POD-backed freight: a line per consignment, the fuel levy on its own. |
| `/debtors` | Who owes what, aged, and the drafts that never went out. |
| `/difot` | Delivered in full, on time, per customer, last 28 days, from the delivery record. |
| `/hours` | Driver work time day by day, breaches flagged against the logbook rules. |
| `/fleet` | COF, rego and RUC clocks on every truck, and the payload each is rated for. |
| `/rates` | The rate cards, the freight moving with no rate, and repricing after a fix. |
| `/claims` | Cargo claims: opened with the CCLA cap stated, decided inside the windows, settled on the record. |
| `/customer` | One account's whole relationship: exposure against the limit, DIFOT, freight, invoices, claims, notes. |
| `/log` | Conversations and decisions onto the record. The disputes read it later. |
| `/weekly-review` | The Monday review, written from three commands. |
| `/compliance` | Six rules from the Acts and the Rules, run against your records, each with its source. |
| `/import` | Bring the business across from TransVirtual or any system that exports CSV. |
| `/draft-overdue-letter` | The chasing letter, from the record, into `drafts/`. |
| `/draft-claim-response` | The claim decision letter with the CCLA position stated, into `drafts/`. |
| `/customise` | Add a field, rename things, change a rule, in plain language. Writes and applies the migration. |
| `/new-view` | Add a read-only HTML dashboard from a description. |

Everything the commands do, the CLI does: `npm run freight -- help`. Any command takes `--json`.

### Documents and views, in your brand

```bash
npm run docs    # tax invoices (PODs listed), run sheets, con notes (carrier's risk stated), customer service reports
npm run view    # the freight and the money, as read-only HTML dashboards
```

Both read [brand.json](brand.json), so your company's name, logo and colours are one file away. Documents land in `docs-out/`, views in `views/`. Print either to PDF from the browser. `/new-view` adds a view, `documents.json` adds a document.

## Compliance, checked against the data

`/compliance` runs the rules in [docs/compliance.md](docs/compliance.md) against your records and reports what is breached. Each rule cites its source, and the CLI enforces the sharpest ones at the gate: `assign` refuses dangerous goods onto an unendorsed driver's run and refuses loads past the rated payload, and `bill` refuses freight with no signed POD.

1. Driver work time inside the logbook rules (Land Transport Rule: Work Time and Logbooks 2007).
2. Every vehicle inside its COF and registration (Vehicle Standards Compliance Rule 2002).
3. RUC licence distance ahead of the hubodometer (Road User Charges Act 2012).
4. Dangerous goods only with D-endorsed drivers (Land Transport Rule: Dangerous Goods 2005).
5. No run loaded past the vehicle's rated payload (VDAM Rule 2016).
6. Cargo claims decided inside the Act's windows (Contract and Commercial Law Act 2017 Part 5).

The Australian equivalents (HVNL fatigue management, NHVR mass limits, the ADG Code, registered charges) are in the same file, at a high level, with the parts to read. Nothing there is legal advice. It is the rule book you point the system at, and you change it to match your operation.

## Ten questions TransVirtual cannot answer

Every one of these is answered by the demo data today. Yours will be different, and that is the point.

1. Which delivered consignments cannot be invoiced right now because no POD is signed, and how many dollars is that, per driver who owes the paperwork?
2. Which customer's DIFOT misses share a cause: the same run, the same lane, the same day of the week?
3. What is each customer really worth: freight billed, minus their claims, against the exposure we carry on them?
4. Which lanes are we carting at the minimum charge so often that the rate card is mispriced?
5. Which consignments moved for $0 this month because no rate card matched, and which lanes keep doing it?
6. Whose work time record would fail a roadside inspection this fortnight, and which runs caused it?
7. Which trucks run out of COF, rego or RUC distance inside the next month, against the runs already planned for them?
8. What did every load on a truck weigh against its rated payload over the last month, and which runs were over?
9. Which claims are open past the Act's windows, and what does the $2,000-per-unit cap make each one actually worth?
10. If two drivers swap runs next week, whose day breaks the 13-hour limit?

## Your first hour: ten things to ask for

Open the folder in Claude Code and say these in your own words. Each one changes the system to fit your operation.

1. "Load our customers, our drivers with their endorsements, and our trucks with their payloads, COF dates and RUC readings."
2. "Our zones are [yours]. Load our standard tariff and our two biggest customers' rate cards."
3. "Put our logo and colours on the invoices, con notes and run sheets, and change the company name to ours."
4. "Our fuel levy is 14.5% and changes monthly. Make it easy to update in one place."
5. "Add a temperature-controlled flag to consignments, and put it on the run sheet."
6. "We run a Saturday metro. Add it to the run patterns and the weekly review."
7. "Add a rule to `/compliance`: no driver does more than 70 hours in a cumulative work period without a 24-hour rest."
8. "We are in Australia. Rebuild the compliance file on the HVNL, the ADG Code and NHVR mass limits."
9. "Build me a Friday page per driver: their runs, their hours, their POD gaps."
10. "Write me a command that drafts the ETA email when a run departs, one per receiver on the manifest."

`/customise` writes the migration, applies it, updates every command that touches the change, and runs the tests.

## Instead of TransVirtual

Export your customers, consignment history and rate cards as CSV, run one command, and the business comes with you. Step by step, with what maps and what deliberately does not: [docs/replace-transvirtual.md](docs/replace-transvirtual.md).

```bash
npm run freight -- import transvirtual --customers=customers.csv --consignments=consignments.csv --rates=rates.csv --dry-run
npm run freight -- import transvirtual --customers=customers.csv --consignments=consignments.csv --rates=rates.csv
```

iCOS Live, MachShip, vWork and any other system that exports CSV go through the same command.

Runs, work time records and claims deliberately do not import: the old system's says-so is not a logbook position. Drivers book their days here from cutover morning, the fleet clocks are set from the actual COF labels and RUC licences on the trucks, and `/compliance` lists exactly what is still unverified. Most operators find at least one surprise on that walk around the yard, which is the argument for the walk.

## Architecture

```
freight-ops-for-claude-code/
  CLAUDE.md                              how the company wants this run (routing table + house rules)
  brand.json                             your name, logo and colours on every document and view
  views.json                             the HTML dashboards npm run view renders
  documents.json                         the paperwork npm run docs renders
  .claude/commands/                      the slash commands
  scripts/freight.mjs                    the CLI the commands drive
  scripts/view.mjs                       read-only HTML dashboards from the SQL views
  scripts/docs.mjs                       the documents, one HTML file per record
  scripts/lib/db.mjs                     one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/                   plain SQL schema, tables and views
  supabase/seed.sql                      demo data (Tui Freight Lines)
  docs/compliance.md                     the rules /compliance checks, each with its source
  docs/replace-transvirtual.md           moving off the incumbent
  docs/why-no-front-end.md               the honest trade-offs
  exports/                               whole database dumps
  drafts/                                letters written for a person to send
```

## Built with Claude Code

This repository was built with Claude Code as the primary development tool, from the schema to the commands, and it is meant to be extended the same way. Ask for a new command and it writes one.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end, nothing that sends, and the gates stay gates.

## Want it installed and run for you?

Enterprise DNA installs Freight Ops for Claude Code for your company, migrates your TransVirtual data, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: https://calendly.com/sam-mckay/discovery-call
- Read more: https://enterprisedna.co/omni/instead-of/transvirtual

## License

MIT. Copyright (c) 2026 Enterprise DNA.
