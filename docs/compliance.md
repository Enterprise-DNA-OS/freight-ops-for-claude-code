# The rule book /compliance runs

`npm run freight -- compliance` checks the records against the rules below and reports what is breached, with the source cited. The CLI also enforces the sharpest ones at the gate: `assign` refuses dangerous goods onto an unendorsed driver's run and refuses loads past the rated payload, and `bill` refuses freight with no signed POD.

**None of this is legal or safety advice.** It is a rule book a New Zealand general freight carrier pointed this system at, written down with sources so it can be checked, argued with, and changed. Your obligations are defined by the Acts, the Land Transport Rules, your operator licence and your own operation; edit this file and the checks together (`/customise` does both).

## The six rules

### 1. worktime: driver work time inside the logbook rules, last 14 days

**Source:** Land Transport Rule: Work Time and Logbooks 2007, under Part 4B of the Land Transport Act 1998: at most 5.5 hours of continuous work before a rest break of at least 30 minutes, at most 13 hours of work time in a cumulative work day, and 70 hours in a cumulative work period before a 24-hour rest. The depart, return and break minutes on each run are the record this system holds.
**The check:** no driver-day in the last 14 days is over 13 hours of net work, and no single run over 5.5 hours has zero recorded break.
**Fix:** a break that was taken but never recorded backfills honestly: `run break <run> <minutes>`. A day genuinely over the limits is a roster problem to fix forward, not a record to edit. If your operation runs to the 70-hour cumulative period as well, add that check here and in the CLI together.

### 2. fleet-certs: every vehicle inside its COF and registration

**Source:** heavy vehicles carry a Certificate of Fitness renewed six-monthly (Land Transport Rule: Vehicle Standards Compliance 2002), and vehicle licensing (rego) sits beside it. Operating without either is an offence, and it reads badly against the operator licence when anything else goes wrong.
**The check:** no active vehicle has a COF or rego due date in the past.
**Fix:** book the inspection, then `vehicle cof <fleet> --done=<date>` (the next due date sets six months out) and `vehicle rego <fleet> --due=<date>` off the new label. The attention list warns from 14 days out, before the breach.

### 3. ruc: RUC licence distance ahead of the hubodometer

**Source:** Road User Charges Act 2012: a RUC vehicle (diesel trucks, in practice) must hold a distance licence covering its current hubodometer reading. Driving past the licence distance is an offence, with assessments and penalties collected retrospectively.
**The check:** no active RUC vehicle has less than 1,000 km between its hubodometer and its licence distance. The threshold is this file's, not the Act's: set it to your weekly kilometres.
**Fix:** buy the next distance block, then `vehicle ruc <fleet> --to-km=`. Keep readings current with `vehicle hubo <fleet> <km>`; the CLI refuses readings that run backwards.

### 4. dangerous-goods: DG only with drivers who hold the D endorsement

**Source:** Land Transport Rule: Dangerous Goods 2005: transporting dangerous goods for hire or reward requires a driver holding a D endorsement, correct dangerous goods documentation, and segregation. The endorsement is on the driver's licence, not on the truck or the company.
**The check:** no consignment flagged dangerous goods sits assigned or picked up on a run whose driver is unendorsed.
**The gate:** `assign` refuses DG onto an unendorsed driver's run outright. What this check catches is the inherited record and the roster change made after assignment.
**Fix:** move the freight to an endorsed driver's run (`assign <con> <run>`), or update the driver record when an endorsement is earned.

### 5. loading: no run past the vehicle's rated payload

**Source:** Land Transport Rule: Vehicle Dimensions and Mass 2016, with overloading offences under the Land Transport Act 1998. Gross and axle limits are absolute; the infringement lands on the operator as well as the driver, and an overloaded truck in a crash is a different legal event entirely.
**The check:** no planned or out run carries more weight than its vehicle's rated payload.
**The gate:** `assign` refuses an assignment that would overload the run; `--force` exists for a wrong rating in the record and is the operator's own call.
**Fix:** move freight to another run or a bigger truck. If the rating in the record is wrong, fix the vehicle record, not the load.

### 6. claims-window: cargo claims decided inside the Act's windows

**Source:** Contract and Commercial Law Act 2017 Part 5 (carriage of goods, the successor to the Carriage of Goods Act 1979). The default contract is at limited carrier's risk: liability capped at $2,000 per unit of goods. The Act puts windows around claims: notice of intention to claim within 30 days of delivery, proceedings within 12 months. A claim left undecided rots both the customer relationship and the legal position.
**The check:** no claim is open and undecided more than 14 days after it was opened. The 14 days is this file's discipline, sized to leave room inside the Act's windows.
**Fix:** decide it (`claim decide <no> --accept|--decline --note=`), settle what is accepted (`claim settle`), and draft the response letter (/draft-claim-response) for a person to send. On a contested claim or anything near the cap, the operator takes legal advice; this file is not it.

## Australia, at a high level

The same shapes exist under different names; a carrier operating in Australia rebuilds this file on the HVNL and its state's rules. The parts to read:

- **Fatigue:** the Heavy Vehicle National Law fatigue management provisions (standard, BFM, AFM hours) replace the NZ work time rule; WA and NT run their own regimes.
- **Roadworthiness:** HVNL inspection and maintenance obligations, and the National Heavy Vehicle Inspection Manual, in place of the COF.
- **Charges:** registration charges replace RUC; there is no distance licence to track, so retire rule 3 or repoint it at service intervals.
- **Dangerous goods:** the Australian Dangerous Goods Code and each state's DG transport Act; driver licensing for DG is state-based.
- **Mass:** HVNL mass limits and the NHVR's mass management schemes; Chain of Responsibility puts the consignor and the operator in scope, which is stricter than the NZ position.
- **Carriage liability:** there is no CCLA-style statutory cap; liability turns on your contract terms. Get the terms on the con note and this file rewritten to match them.

`/customise` rewrites the rules and the checks together. Change the words and the SQL in the same commit, so the report never claims a rule the doc does not carry.
