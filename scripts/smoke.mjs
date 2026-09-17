#!/usr/bin/env node
// End-to-end smoke test on a throwaway embedded database.
// Runs migrate, seed, then every CLI command that matters, and asserts on the JSON.
// Passes on Windows and Linux. No network, no Postgres install.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'freight-smoke-'));
const env = { ...process.env, DATA_DIR: dataDir };
delete env.DATABASE_URL; // the smoke test always runs embedded

let step = 0;
function run(label, args, { json = true, expectFail = false } = {}) {
  step++;
  const argv = [path.join(root, 'scripts', args[0]), ...args.slice(1), ...(json ? ['--json'] : [])];
  const res = spawnSync(process.execPath, argv, { cwd: root, env, encoding: 'utf8' });
  const ok = expectFail ? res.status !== 0 : res.status === 0;
  if (!ok) {
    console.error(`\nFAIL step ${step} (${label}): exit ${res.status}\n--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`);
    process.exit(1);
  }
  console.log(`  ok  ${String(step).padStart(2)}  ${label}`);
  if (!json || expectFail) return { stdout: res.stdout, stderr: res.stderr };
  try {
    return JSON.parse(res.stdout);
  } catch {
    console.error(`\nFAIL step ${step} (${label}): output is not JSON\n${res.stdout}\n${res.stderr}`);
    process.exit(1);
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`\nFAIL assertion: ${msg}`);
    process.exit(1);
  }
}

const n = (v) => Number(v ?? 0);

// Local date, the same way the CLI computes "today". Never UTC: New Zealand is a day ahead of it.
const todayIso = (() => {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();

console.log(`smoke: data dir ${dataDir}`);
try {
  run('migrate', ['migrate.mjs'], { json: false });
  run('migrate again (idempotent)', ['migrate.mjs'], { json: false });
  run('seed', ['seed.mjs'], { json: false });
  run('seed again (idempotent)', ['seed.mjs'], { json: false });

  // ---- the board --------------------------------------------------------------

  const board = run('board', ['freight.mjs', 'board']);
  assert(board.length === 11, `eleven open consignments (${board.length})`);
  const late = board.find((b) => b.con_no === 'CON-1311');
  assert(n(late.days_late) === 2 && late.status === 'assigned', 'the joinery consignment is 2 days past required');
  assert(board.some((b) => b.on_stop && b.status === 'on-hold'), 'the stopped account shows with its freight on hold');
  assert(board.some((b) => b.con_no === 'CON-1313' && !b.rate_desc), 'the Nelson consignment shows with no rate');

  const con = run('one consignment', ['freight.mjs', 'con', 'CON-1314']);
  assert(con.con.customer_name === 'Tararua Brewing Co Ltd', 'resolved by con number');
  assert(con.con.dangerous_goods && con.con.dg_class === '3', 'the DG flag and class are on the card');
  assert(con.run && con.run.run_no === 'RUN-410', 'with its run');

  const byReceiver = run('resolve by receiver', ['freight.mjs', 'con', 'Trade Depot']);
  assert(byReceiver.con.con_no === 'CON-1305', 'Trade Depot resolves to CON-1305');

  const noSuch = run('an unknown consignment exits 1', ['freight.mjs', 'con', 'no such thing anywhere'], { json: false, expectFail: true });
  assert(/No con matches/.test(noSuch.stderr), 'and says so plainly');

  const ambiguous = run('an ambiguous match exits 1 and lists candidates', ['freight.mjs', 'con', 'CON-13'], { json: false, expectFail: true });
  assert(/matches \d+ con records/.test(ambiguous.stderr), 'with the candidates listed');

  // ---- runs, drivers, fleet ----------------------------------------------------

  const runs = run('runs', ['freight.mjs', 'runs']);
  assert(runs.length === 5, `five runs in the last week and ahead (${runs.length})`);
  const metro = runs.find((r) => r.run_no === 'RUN-410');
  assert(n(metro.load_kg) === 8450 && n(metro.max_payload_kg) === 8000 && n(metro.load_pct) === 106, 'the metro run is 106% loaded');
  assert(metro.has_dg, 'and carries dangerous goods');

  const manifest = run('one run manifest', ['freight.mjs', 'run', 'RUN-410']);
  assert(manifest.stops.length === 5, `five stops on the manifest (${manifest.stops.length})`);
  assert(manifest.stops[0].con_no === 'CON-1315', 'in drop order');

  const hours = run('hours', ['freight.mjs', 'hours']);
  const deanBreach = hours.find((h) => h.driver === 'Dean Kereama' && h.no_break_run);
  assert(deanBreach && n(deanBreach.work_minutes) === 375, 'Dean ran 6h15 with no recorded break');
  assert(!hours.some((h) => h.driver === 'Mike Tairea' && h.no_break_run), 'Mike took his break, no flag');

  const driver = run('one driver', ['freight.mjs', 'driver', 'Aroha']);
  assert(driver.driver.dg_endorsed === true, 'Aroha holds the D endorsement');

  const fleet = run('fleet', ['freight.mjs', 'fleet']);
  assert(fleet.length === 6, `six vehicles (${fleet.length})`);
  assert(fleet.some((f) => f.fleet_no === 'T-02' && n(f.cof_days) === -8), 'T-02 COF is 8 days overdue');
  assert(fleet.some((f) => f.fleet_no === 'T-01' && n(f.ruc_remaining_km) === 400), 'T-01 has 400 km left on its RUC');
  assert(fleet.some((f) => f.fleet_no === 'V-05' && f.ruc_paid_to_km === null), 'the petrol van carries no RUC');

  // ---- the money ---------------------------------------------------------------

  const pods = run('pods', ['freight.mjs', 'pods']);
  assert(pods.length === 3, `three deliveries missing PODs (${pods.length})`);
  assert(pods[0].con_no === 'CON-1301' && n(pods[0].days_waiting) === 9, 'the oldest gap is 9 days');

  const stats = run('stats', ['freight.mjs', 'stats']);
  assert(n(stats.unbilled_cents) === 151400, `$1,514 of POD-backed freight unbilled (${stats.unbilled_cents})`);
  assert(n(stats.pod_gaps) === 3 && n(stats.open_claims) === 1, 'stats agree with the lists');

  const rateGap = run('rate check', ['freight.mjs', 'rate', 'check']);
  assert(rateGap.length === 1 && rateGap[0].con_no === 'CON-1313', 'only the Nelson consignment has no rate');

  const debtors = run('debtors', ['freight.mjs', 'debtors']);
  assert(debtors.some((d) => d.number === 'INV-2040' && n(d.days_overdue) === 32), 'the 32 day overdue invoice shows');
  assert(debtors.some((d) => d.status === 'draft'), 'so does the draft that never went out');

  const difot = run('difot', ['freight.mjs', 'difot']);
  const mfp = difot.find((d) => d.customer === 'Manawatu Fresh Produce Ltd');
  assert(n(mfp.difot_pct) === 60 && n(mfp.delivered) === 5, `Manawatu Fresh DIFOT is 60% (${mfp.difot_pct})`);
  const kbc = difot.find((d) => d.customer === 'Kapiti Beverage Co Ltd');
  assert(n(kbc.difot_pct) === 75, 'Kapiti Beverage sits at 75%');

  const customers = run('customers', ['freight.mjs', 'customers']);
  assert(customers.length === 12, `twelve customers (${customers.length})`);
  const over = customers.find((c) => c.customer === 'Manawatu Fresh Produce Ltd');
  assert(n(over.exposure_cents) === 1273600 && n(over.exposure_cents) > n(over.credit_limit_cents), 'Manawatu Fresh is over its limit');

  const custCard = run('customer card', ['freight.mjs', 'customer', 'Kapiti']);
  assert(custCard.customer.name === 'Kapiti Beverage Co Ltd', 'resolved by partial name');
  assert(custCard.claims.some((c) => c.claim_no === 'CLM-30'), 'with its open claim');

  // ---- attention and compliance -------------------------------------------------

  const attention = run('attention', ['freight.mjs', 'attention']);
  assert(attention.length === 23, `the attention list is loud (${attention.length})`);
  for (const reason of ['dg_unendorsed', 'overloaded_run', 'worktime_breach', 'fleet_cert_due', 'ruc_low',
    'late_delivery', 'consignment_stuck', 'pod_missing', 'exception_no_claim', 'unbilled_delivered',
    'rate_missing', 'claim_open', 'invoice_overdue', 'invoice_draft', 'over_credit_limit', 'task_overdue']) {
    assert(attention.some((a) => a.reason === reason), `attention carries ${reason}`);
  }
  assert(attention.filter((a) => a.reason === 'pod_missing').length === 3, 'all three POD gaps show');

  const compliance = run('compliance', ['freight.mjs', 'compliance']);
  assert(compliance.length === 6, 'six rules in the book');
  assert(compliance.every((r) => r.breaches.length > 0), 'every rule breached in the seed, deliberately');
  const oneRule = run('one compliance rule', ['freight.mjs', 'compliance', 'ruc']);
  assert(oneRule.length === 1 && oneRule[0].breaches.length === 1, 'run one rule on its own');

  // ---- booking and rating --------------------------------------------------------

  const stopped = run('booking a stopped account is refused', ['freight.mjs', 'book', 'Rangitikei', '--from-zone=PMR', '--to-zone=WLG', '--weight=500'], { json: false, expectFail: true });
  assert(/ON STOP/.test(stopped.stderr), 'and the refusal names the stop');

  const noZones = run('booking with no lane is refused', ['freight.mjs', 'book', 'Levin Pet'], { json: false, expectFail: true });
  assert(/--from-zone/.test(noZones.stderr), 'the refusal says what to give');

  const booked = run('book off the standard tariff', ['freight.mjs', 'book', 'Levin Pet', '--from-zone=PMR', '--to-zone=WLG', '--weight=500', '--receiver=Animates Porirua', `--required=${todayIso}`]);
  assert(booked.con_no === 'CON-1321', `the con number is minted (${booked.con_no})`);
  assert(n(booked.charge_cents) === 9000, `500 kg at 18c/kg (${booked.charge_cents})`);

  const cardBooked = run('a customer card beats the tariff', ['freight.mjs', 'book', 'Manawatu Fresh', '--from-zone=PMR', '--to-zone=WLG', '--weight=1500', '--pallets=3']);
  assert(n(cardBooked.charge_cents) === 14400, `3 pallets at the customer's $48 (${cardBooked.charge_cents})`);

  const noRate = run('an unpriced lane books at $0, loudly', ['freight.mjs', 'book', 'Central Ag', '--from-zone=PMR', '--to-zone=CHC', '--weight=200']);
  assert(noRate.rate_missing === true && n(noRate.charge_cents) === 0, 'flagged rate_missing');
  run('add the missing lane', ['freight.mjs', 'rate', 'add', 'PMR', 'CHC', '--rate=25', '--min=45']);
  const rerated = run('rerate it', ['freight.mjs', 'rerate', noRate.con_no]);
  assert(n(rerated.charge_cents) === 5000, `200 kg at 25c/kg (${rerated.charge_cents})`);

  // ---- the gates on the run ------------------------------------------------------

  const dgRefused = run('DG onto an unendorsed run is refused', ['freight.mjs', 'assign', 'CON-1314', 'RUN-412'], { json: false, expectFail: true });
  assert(/Dangerous Goods 2005/.test(dgRefused.stderr), 'and the refusal cites the rule');

  const overloadRefused = run('overloading a run is refused', ['freight.mjs', 'assign', 'CON-1310', 'RUN-410'], { json: false, expectFail: true });
  assert(/Vehicle Dimensions and Mass/.test(overloadRefused.stderr), 'citing the mass rule');

  const holdRefused = run('assigning held freight is refused', ['freight.mjs', 'assign', 'CON-1312', 'RUN-411'], { json: false, expectFail: true });
  assert(/on hold/.test(holdRefused.stderr), 'the hold is a decision, not a queue');

  const dgFixed = run('DG moves to the endorsed driver', ['freight.mjs', 'assign', 'CON-1314', 'RUN-411']);
  assert(n(dgFixed.load_kg) === 2170, `RUN-411 load after the move (${dgFixed.load_kg})`);
  const overloadFixed = run('the heavy drop moves too', ['freight.mjs', 'assign', 'CON-1315', 'RUN-411']);
  assert(n(overloadFixed.load_kg) === 5370, `RUN-411 load (${overloadFixed.load_kg})`);
  const run410After = run('the metro run is legal again', ['freight.mjs', 'run', 'RUN-410']);
  assert(n(run410After.run.load_kg) === 5130 && !run410After.run.has_dg, 'load 5130 kg, no DG');

  // ---- a delivery day, end to end -------------------------------------------------

  run('the linehaul departs', ['freight.mjs', 'run', 'depart', 'RUN-411', `--at=${todayIso} 06:00`]);
  run('pickup', ['freight.mjs', 'pickup', 'CON-1319']);
  const noPod = run('delivering without a POD is refused', ['freight.mjs', 'deliver', 'CON-1319'], { json: false, expectFail: true });
  assert(/--pod=/.test(noPod.stderr), 'the refusal says what billing stands on');
  const delivered = run('deliver against a signature', ['freight.mjs', 'deliver', 'CON-1319', '--pod=R. Aporo', `--at=${todayIso} 10:40`]);
  assert(delivered.pod_name === 'R. Aporo', 'the POD is on the record');
  const atl = run('an unsigned delivery records the gap loudly', ['freight.mjs', 'deliver', 'CON-1311', '--no-pod', `--at=${todayIso} 11:20`]);
  assert(atl.pod_name === null, 'no signature invented');
  const returned = run('the run returns with its break recorded', ['freight.mjs', 'run', 'return', 'RUN-411', `--at=${todayIso} 17:45`, '--break=45']);
  assert(returned.worktime_warning === false, '11 hours net with a break: no breach');

  // ---- POD chase, then the billing run ----------------------------------------------

  run('the app coughs up the old PODs', ['freight.mjs', 'pod', 'CON-1301', '--name=J. Nand']);
  run('pod 2', ['freight.mjs', 'pod', 'CON-1302', '--name=L. Prasad']);
  run('pod 3', ['freight.mjs', 'pod', 'CON-1303', '--name=M. Terry']);
  run('pod for the ATL drop', ['freight.mjs', 'pod', 'CON-1311', '--name=Site office (photo)']);
  const podsAfter = run('the gap list is empty', ['freight.mjs', 'pods']);
  assert(podsAfter.length === 0, 'no PODs missing');

  const dryBill = run('bill --dry-run writes nothing', ['freight.mjs', 'bill', 'Foxton', '--dry-run']);
  assert(dryBill.dry_run === true && dryBill.invoices.length === 1 && n(dryBill.invoices[0].total_cents) === 37800, 'freight plus the 12.5% fuel levy');
  const billed = run('bill one customer', ['freight.mjs', 'bill', 'Foxton']);
  assert(billed.invoices[0].number === 'INV-2044' && n(billed.invoices[0].total_cents) === 37800, `$378 drafted (${billed.invoices[0].total_cents})`);
  const billAll = run('bill the rest', ['freight.mjs', 'bill']);
  assert(billAll.invoices.length === 6, `six more drafts (${billAll.invoices.length})`);
  const kapitiInv = billAll.invoices.find((i) => i.customer === 'Kapiti Beverage Co Ltd');
  assert(n(kapitiInv.total_cents) === 42735, `Kapiti freight plus its 10% levy (${kapitiInv.total_cents})`);
  const nothing = run('billing again finds nothing', ['freight.mjs', 'bill'], { json: false, expectFail: true });
  assert(/Nothing billable/.test(nothing.stderr), 'the meter moved onto the invoices');

  run('send it', ['freight.mjs', 'invoice', 'sent', 'INV-2044']);
  run('it gets paid', ['freight.mjs', 'invoice', 'paid', 'INV-2044']);
  const draftPaid = run('a draft cannot be paid', ['freight.mjs', 'invoice', 'paid', 'INV-2042'], { json: false, expectFail: true });
  assert(/Only a sent invoice/.test(draftPaid.stderr), 'sent comes first');

  const invCard = run('one invoice with its lines', ['freight.mjs', 'invoice', 'INV-2044']);
  assert(invCard.lines.length === 2 && invCard.lines.some((l) => /Fuel levy/.test(l.description)), 'the levy is its own line');

  // ---- claims, inside the Act's windows -----------------------------------------------

  const claim = run('open the claim for the wet waders', ['freight.mjs', 'claim', 'open', 'CON-1308', '--kind=damage', '--amount=450', '--desc=Carton torn open and wet']);
  assert(claim.claim_no === 'CLM-31' && n(claim.cap_cents) === 200000, 'the CCLA cap is stated at $2,000 a unit');
  run('decline it with a reason', ['freight.mjs', 'claim', 'decide', 'CLM-31', '--decline', '--note=Packaging failure on the sender side; photos attached']);
  run('decide the stale glassware claim', ['freight.mjs', 'claim', 'decide', 'CLM-30', '--accept', '--note=Mispacked by our loader']);
  run('settle it', ['freight.mjs', 'claim', 'settle', 'CLM-30', '--amount=1850']);
  const doubleDecide = run('a decided claim stays decided', ['freight.mjs', 'claim', 'decide', 'CLM-31', '--accept'], { json: false, expectFail: true });
  assert(/already declined/.test(doubleDecide.stderr), 'no quiet rewrites');

  // ---- fix the compliance story, watch the book come clean ------------------------------

  run('the missed break was taken, never recorded', ['freight.mjs', 'run', 'break', 'RUN-402', '30']);
  run('T-02 passes its COF', ['freight.mjs', 'vehicle', 'cof', 'T-02']);
  run('the next RUC block goes on T-01', ['freight.mjs', 'vehicle', 'ruc', 'T-01', '--to-km=492000']);
  const huboBack = run('hubodometers do not run backwards', ['freight.mjs', 'vehicle', 'hubo', 'T-01', '480000'], { json: false, expectFail: true });
  assert(/backwards/.test(huboBack.stderr), 'the reading is checked');
  const hubo = run('a real reading lands', ['freight.mjs', 'vehicle', 'hubo', 'T-01', '482100']);
  assert(n(hubo.ruc_remaining_km) === 9900, `9,900 km of headroom (${hubo.ruc_remaining_km})`);

  const complianceAfter = run('the compliance book comes clean', ['freight.mjs', 'compliance']);
  const failing = complianceAfter.filter((r) => r.breaches.length).map((r) => r.key);
  assert(failing.length === 0, `every rule now passes (still failing: ${failing.join(',') || 'none'})`);

  // ---- the office ----------------------------------------------------------------------

  run('log a call', ['freight.mjs', 'log', 'Karen called: cheque in the mail, again.', '--customer=Manawatu Fresh']);
  run('task done', ['freight.mjs', 'task', 'done', 'Book T-02 in for its COF']);
  run('hold with a reason', ['freight.mjs', 'hold', 'CON-1321', '--reason=Receiver closed for stocktake']);
  run('release it', ['freight.mjs', 'release', 'CON-1321']);
  const noReason = run('cancelling needs a reason', ['freight.mjs', 'cancel', 'CON-1322'], { json: false, expectFail: true });
  assert(/--reason/.test(noReason.stderr), 'the record demands it');
  run('cancel with one', ['freight.mjs', 'cancel', 'CON-1322', '--reason=Customer booked it twice']);

  // ---- import ---------------------------------------------------------------------------

  const customersCsv = path.join(dataDir, 'customers.csv');
  const consCsv = path.join(dataDir, 'consignments.csv');
  const ratesCsv = path.join(dataDir, 'rates.csv');
  writeFileSync(customersCsv, [
    'Customer,Customer Code,Contact,Email,Phone,Suburb,Payment Terms',
    '"Kowhai Distribution Ltd",KOW001,Tim Rapana,tim@kowhaidist.example.nz,06 555 0801,Palmerston North,20',
    '"Otaki Growers Co-op",OGC001,Jo Craddock,jo@otakigrowers.example.nz,06 555 0802,Otaki,14',
    '"Manawatu Fresh Produce Ltd",MFP001,Karen Tapa,accounts@manawatufresh.example.nz,06 555 0501,Palmerston North,20',
  ].join('\n'));
  writeFileSync(consCsv, [
    'Connote,Customer,Receiver,Receiver Address,From Zone,To Zone,Service,Items,Pallets,Weight,Booked Date,Required Date,Delivered Date,POD Name,Freight Charge',
    `TVC-9001,"Kowhai Distribution Ltd","New World Otaki","Main Highway, Otaki",PMR,WLG,general,4,2,900,${todayIso},${todayIso},${todayIso},K. Rihari,86.00`,
    `TVC-9002,"Otaki Growers Co-op","Moore Wilsons Wellington","Tory St, Wellington",PMR,WLG,general,6,3,1400,${todayIso},,,,120.50`,
  ].join('\n'));
  writeFileSync(ratesCsv, [
    'From Zone,To Zone,Service,Basis,Rate,Min',
    'PMR,NSN,general,per kg,0.20,40.00',
  ].join('\n'));

  const dry = run('import dry run writes nothing', ['freight.mjs', 'import', 'transvirtual', `--customers=${customersCsv}`, `--consignments=${consCsv}`, `--rates=${ratesCsv}`, '--dry-run']);
  assert(n(dry.customers) === 2 && n(dry.customers_updated) === 1, 'the dry run counts customers');
  assert(n(dry.consignments) === 2 && n(dry.rates) === 1, 'and consignments and rates');

  const imported = run('import for real', ['freight.mjs', 'import', 'transvirtual', `--customers=${customersCsv}`, `--consignments=${consCsv}`, `--rates=${ratesCsv}`]);
  assert(n(imported.customers) === 2 && n(imported.consignments) === 2 && n(imported.rates) === 1, 'and the real run does it');

  const importedCon = run('the delivered import landed delivered', ['freight.mjs', 'con', 'TVC-9001']);
  assert(importedCon.con.status === 'delivered' && importedCon.con.pod_name === 'K. Rihari', 'with its POD');
  const openImport = run('the open import landed booked', ['freight.mjs', 'con', 'TVC-9002']);
  assert(openImport.con.status === 'booked' && n(openImport.con.charge_cents) === 12050, 'with its charge');

  const nelsonRated = run('the imported lane prices the Nelson freight', ['freight.mjs', 'rerate', 'CON-1313']);
  assert(n(nelsonRated.charge_cents) === 16000, `800 kg at 20c/kg (${nelsonRated.charge_cents})`);

  const reimport = run('re-importing updates rather than duplicating', ['freight.mjs', 'import', 'transvirtual', `--customers=${customersCsv}`, `--consignments=${consCsv}`]);
  assert(n(reimport.customers) === 0 && n(reimport.customers_updated) === 3, 'the second run creates no customers');
  assert(n(reimport.consignments) === 0 && n(reimport.consignments_updated) === 2, 'and no consignments');

  const missingFile = run('a missing import file fails loudly', ['freight.mjs', 'import', 'transvirtual', `--customers=${path.join(dataDir, 'not-there.csv')}`], { json: false, expectFail: true });
  assert(/No customers file/.test(missingFile.stderr), 'it exits non zero rather than importing nothing quietly');

  // ---- export ---------------------------------------------------------------------------

  const outFile = path.join(dataDir, 'dump.json');
  const dump = run('export', ['freight.mjs', 'export', `--out=${outFile}`]);
  assert(existsSync(outFile), 'the export file is on disk');
  const parsed = JSON.parse(readFileSync(outFile, 'utf8'));
  assert(parsed.customers.length === n(dump.counts.customers), 'the counts match the file');
  assert(parsed.consignments.length === n(dump.counts.consignments), 'consignments included');

  // ---- the branded HTML ------------------------------------------------------------------

  const views = run('npm run view', ['view.mjs'], { json: false });
  assert(/views[\\/]ops\.html/.test(views.stdout) && /views[\\/]money\.html/.test(views.stdout), 'both views rendered');
  const opsHtml = readFileSync(path.join(root, 'views', 'ops.html'), 'utf8');
  assert(opsHtml.includes('Needs a decision') && opsHtml.includes('The runs'), 'the ops view has its sections');
  const moneyHtml = readFileSync(path.join(root, 'views', 'money.html'), 'utf8');
  assert(moneyHtml.includes('Ready to bill') && moneyHtml.includes('Customer exposure'), 'the money view has its sections');

  const docs = run('npm run docs', ['docs.mjs'], { json: false });
  assert(/invoice/.test(docs.stdout), 'the invoices rendered');
  assert(/run-sheet/.test(docs.stdout), 'the run sheets rendered');
  assert(/con-note/.test(docs.stdout), 'the consignment notes rendered');
  assert(/service-report/.test(docs.stdout), 'the customer service reports rendered');

  // ---- the human readable side --------------------------------------------------------------

  run('board (text)', ['freight.mjs', 'board'], { json: false });
  run('con (text)', ['freight.mjs', 'con', 'CON-1310'], { json: false });
  run('runs (text)', ['freight.mjs', 'runs', '--all'], { json: false });
  run('run (text)', ['freight.mjs', 'run', 'RUN-410'], { json: false });
  run('pods (text)', ['freight.mjs', 'pods'], { json: false });
  run('hours (text)', ['freight.mjs', 'hours'], { json: false });
  run('drivers (text)', ['freight.mjs', 'drivers'], { json: false });
  run('driver (text)', ['freight.mjs', 'driver', 'Dean'], { json: false });
  run('fleet (text)', ['freight.mjs', 'fleet'], { json: false });
  run('vehicle (text)', ['freight.mjs', 'vehicle', 'T-01'], { json: false });
  run('rates (text)', ['freight.mjs', 'rates'], { json: false });
  run('rate check (text)', ['freight.mjs', 'rate', 'check'], { json: false });
  run('invoices (text)', ['freight.mjs', 'invoices', '--all'], { json: false });
  run('invoice (text)', ['freight.mjs', 'invoice', 'INV-2041'], { json: false });
  run('debtors (text)', ['freight.mjs', 'debtors'], { json: false });
  run('difot (text)', ['freight.mjs', 'difot'], { json: false });
  run('claims (text)', ['freight.mjs', 'claims', '--all'], { json: false });
  run('claim (text)', ['freight.mjs', 'claim', 'CLM-30'], { json: false });
  run('customers (text)', ['freight.mjs', 'customers'], { json: false });
  run('customer (text)', ['freight.mjs', 'customer', 'Manawatu Fresh'], { json: false });
  run('tasks (text)', ['freight.mjs', 'tasks', '--all'], { json: false });
  run('attention (text)', ['freight.mjs', 'attention'], { json: false });
  run('compliance (text)', ['freight.mjs', 'compliance'], { json: false });
  run('stats (text)', ['freight.mjs', 'stats'], { json: false });
  run('help', ['freight.mjs', 'help'], { json: false });
  run('an unknown command exits 1', ['freight.mjs', 'nonsense'], { json: false, expectFail: true });

  console.log(`\n${step} checks, PASS`);
} finally {
  if (existsSync(dataDir)) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Windows can hold the handle briefly; a leftover temp dir is harmless.
    }
  }
}
