#!/usr/bin/env node
// freight-ops-for-claude-code: the one CLI. Claude Code slash commands call
// this; so can you.
//
//   node scripts/freight.mjs <command> [args] [--flags] [--json]
//
// Run with no arguments (or `help`) for the command list.
//
// This system records what a general freight carrier runs on every week: the
// consignments from booking to signed POD, the runs and the drivers' work
// time, the trucks with their COF, rego and RUC clocks, the rate cards that
// price each booking the day it is made, the invoice run that bills delivered
// POD-backed freight, and the cargo claims handled inside the Act's windows.
// It sends nothing, pays nothing and talks to no accounting system on its
// own: invoices are drafted here and a person sends them.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table, money, isoDate, short, truncate, heading, bar } from './lib/format.mjs';

// ---------------------------------------------------------------------------
// Argument parsing

const BOOL_FLAGS = new Set([
  'json', 'help', 'all', 'dry-run', 'force', 'dg', 'no-pod', 'accept', 'decline',
]);

function parseArgv(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      flags.help = true;
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let name;
      let value;
      if (eq > -1) {
        name = a.slice(2, eq);
        value = a.slice(eq + 1);
      } else {
        name = a.slice(2);
        const next = argv[i + 1];
        if (BOOL_FLAGS.has(name) || next === undefined || next.startsWith('--')) value = true;
        else value = argv[++i];
      }
      flags[name] = value;
    } else {
      args.push(a);
    }
  }
  return { args, flags };
}

class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

const num = (v) => Number(v ?? 0);
const str = (v) => (v === true || v === undefined || v === null ? '' : String(v));

// ---------------------------------------------------------------------------
// Dates, money, quantities

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(v, what = 'date') {
  if (!v || v === true) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const lower = s.toLowerCase();
  if (lower === 'today') return today();
  if (lower === 'yesterday') return addDays(today(), -1);
  if (lower === 'tomorrow') return addDays(today(), 1);
  // New Zealand and Australian exports write DD/MM/YYYY, so the first number
  // is the day unless the second one is too big to be a month.
  const slash = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const [day, month] = b > 12 ? [b, a] : [a, b];
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new CliError(`"${v}" is not a ${what}. Use YYYY-MM-DD.`);
  return isoDate(d);
}

// "14:05" (today), "2026-09-17 14:05", or a bare date (midnight).
function parseWhen(v, what = 'time') {
  if (!v || v === true) return new Date().toISOString();
  const s = String(v).trim();
  if (/^\d{1,2}:\d{2}$/.test(s)) return `${today()} ${s.padStart(5, '0')}`;
  const dt = s.match(/^(\S+)[ T](\d{1,2}:\d{2})$/);
  if (dt) return `${parseDate(dt[1], what)} ${dt[2].padStart(5, '0')}`;
  return `${parseDate(s, what)} 00:00`;
}

function parseMoney(v) {
  if (v === undefined || v === null || v === '' || v === true) return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  if (Number.isNaN(n)) throw new CliError(`"${v}" is not an amount.`);
  return Math.round(n * 100);
}

function parseQty(v, what = 'quantity') {
  if (v === undefined || v === null || v === true) return 0;
  const n = Number(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n)) throw new CliError(`"${v}" is not a ${what}.`);
  return n;
}

// ---------------------------------------------------------------------------
// Lookups: full id, first 4+ characters of an id, exact code or ref or name,
// then contains. One hit wins. Several hits list the candidates and exit 1.

const RESOLVERS = {
  customer: {
    from: 'customers c',
    cols: 'c.*',
    exact: "lower(c.name) = lower($1) or lower(coalesce(c.code, '')) = lower($1) or lower(coalesce(c.email, '')) = lower($1)",
    fuzzy: 'c.name ilike $1 or c.contact_name ilike $1',
    label: (r) => `${r.name}${r.on_stop ? ' (ON STOP)' : ''}`,
    order: 'c.name',
    listing: 'customers',
  },
  driver: {
    from: 'drivers c',
    cols: 'c.*',
    exact: "lower(c.full_name) = lower($1) or lower(coalesce(c.code, '')) = lower($1)",
    fuzzy: 'c.full_name ilike $1',
    label: (r) => `${r.full_name} (${r.licence_class}${r.dg_endorsed ? ', D endorsed' : ''})`,
    order: 'c.full_name',
    listing: 'drivers',
  },
  vehicle: {
    from: 'vehicles c',
    cols: 'c.*',
    exact: "lower(c.fleet_no) = lower($1) or lower(coalesce(c.rego, '')) = lower($1)",
    fuzzy: 'c.fleet_no ilike $1 or c.rego ilike $1 or c.description ilike $1',
    label: (r) => `${r.fleet_no}  ${r.description || ''} (${r.max_payload_kg} kg)`,
    order: 'c.fleet_no',
    listing: 'fleet',
  },
  run: {
    from: 'runs c left join drivers d on d.id = c.driver_id left join vehicles v on v.id = c.vehicle_id',
    cols: 'c.*, d.full_name as driver_name, d.dg_endorsed as driver_dg_endorsed, v.fleet_no, v.max_payload_kg',
    exact: "lower(c.run_no) = lower($1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.run_no ilike $1 or c.name ilike $1 or d.full_name ilike $1',
    label: (r) => `${r.run_no}  ${r.name || ''} ${isoDate(r.run_date)} (${r.status})`,
    order: 'c.run_date desc',
    listing: 'runs --all',
  },
  con: {
    from: 'consignments c join customers cu on cu.id = c.customer_id',
    cols: 'c.*, cu.name as customer_name, cu.on_stop, cu.terms_days, cu.fuel_levy_pct',
    exact: "lower(c.con_no) = lower($1) or lower(coalesce(c.customer_ref, '')) = lower($1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.con_no ilike $1 or cu.name ilike $1 or c.receiver_name ilike $1',
    label: (r) => `${r.con_no}  ${r.customer_name} to ${truncate(r.receiver_name || r.dest_zone, 30)} (${r.status})`,
    order: 'c.created_at desc',
    listing: 'board',
  },
  invoice: {
    from: 'invoices c join customers cu on cu.id = c.customer_id',
    cols: 'c.*, cu.name as customer_name',
    exact: "lower(c.number) = lower($1)",
    fuzzy: 'c.number ilike $1 or cu.name ilike $1',
    label: (r) => `${r.number}  ${r.customer_name} ${money(r.total_cents)} (${r.status})`,
    order: 'c.issued_on desc',
    listing: 'invoices --all',
  },
  claim: {
    from: 'claims c join consignments cn on cn.id = c.consignment_id join customers cu on cu.id = cn.customer_id',
    cols: 'c.*, cn.con_no, cu.name as customer_name',
    exact: "lower(c.claim_no) = lower($1)",
    fuzzy: 'c.claim_no ilike $1 or cn.con_no ilike $1 or cu.name ilike $1',
    label: (r) => `${r.claim_no}  ${r.kind} on ${r.con_no} ${money(r.claimed_cents)} (${r.status})`,
    order: 'c.opened_on desc',
    listing: 'claims --all',
  },
  task: {
    from: 'tasks c left join customers cu on cu.id = c.customer_id',
    cols: 'c.*, cu.name as customer_name',
    exact: 'lower(c.title) = lower($1)',
    fuzzy: 'c.title ilike $1 or cu.name ilike $1',
    label: (r) => `${short(r.id)}  ${truncate(r.title, 50)} (${r.status})`,
    order: 'c.due_on',
    listing: 'tasks --all',
  },
};

const ID_RE = /^[0-9a-f]{4,8}(-[0-9a-f-]*)?$/i;

async function resolve(db, kind, q, { optional = false } = {}) {
  const spec = RESOLVERS[kind];
  q = String(q ?? '').trim();
  if (!q || q === 'true') {
    if (optional) return null;
    throw new CliError(`Give me a ${kind} name, code or id.`);
  }
  const select = `select ${spec.cols} from ${spec.from}`;
  let rows = [];
  if (ID_RE.test(q)) {
    rows = await db.query(`${select} where c.id::text like $1 order by ${spec.order}`, [q.toLowerCase() + '%']);
    if (rows.length === 1) return rows[0];
  }
  if (!rows.length) rows = await db.query(`${select} where ${spec.exact} order by ${spec.order}`, [q]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) rows = await db.query(`${select} where ${spec.fuzzy} order by ${spec.order}`, [`%${q}%`]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) {
    if (optional) return null;
    throw new CliError(`No ${kind} matches "${q}". Run \`${spec.listing}\` to see what exists.`);
  }
  throw new CliError(
    `"${q}" matches ${rows.length} ${kind} records. Use a code, an id, or a longer name:\n` +
      rows.map((r) => `  ${short(r.id)}  ${spec.label(r)}`).join('\n'),
  );
}

async function nextRef(db, tbl, col, prefix, start) {
  const rows = await db.query(`select ${col} as v from ${tbl} where ${col} like '${prefix}-%'`);
  let max = start;
  for (const r of rows) {
    const n = Number(String(r.v).slice(prefix.length + 1));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${max + 1}`;
}

// ---------------------------------------------------------------------------
// Output

let JSON_MODE = false;
function out(json, text) {
  if (JSON_MODE) console.log(JSON.stringify(json, null, 2));
  else console.log(typeof text === 'function' ? text() : text);
}

// ---------------------------------------------------------------------------
// Rating: the customer's own card beats the standard tariff; the charge and
// the match are stamped onto the consignment at booking and never silently
// recomputed. Returns null when no card covers the lane.

async function findRate(db, customerId, origin, dest, service) {
  const rows = await db.query(
    `select r.*, cu.name as customer_name from rate_cards r
     left join customers cu on cu.id = r.customer_id
     where lower(r.origin_zone) = lower($2) and lower(r.dest_zone) = lower($3)
       and lower(r.service) = lower($4)
       and (r.customer_id = $1 or r.customer_id is null)
     order by r.customer_id nulls last limit 1`,
    [customerId, origin, dest, service],
  );
  return rows[0] || null;
}

function applyRate(rate, { weight_kg = 0, pallets = 0, items = 1 }) {
  let charge;
  if (rate.basis === 'per_kg') charge = Math.round(num(weight_kg) * num(rate.rate_cents));
  else if (rate.basis === 'per_pallet') charge = Math.round(num(pallets) * num(rate.rate_cents));
  else charge = Math.round(num(items) * num(rate.rate_cents));
  charge = Math.max(charge, num(rate.min_charge_cents));
  const who = rate.customer_id ? `${rate.customer_name} card` : 'Standard';
  return {
    charge_cents: charge,
    rate_desc: `${who} ${rate.origin_zone}-${rate.dest_zone}${rate.service !== 'general' ? ' ' + rate.service : ''} ${rate.basis.replace('_', ' ')}`,
  };
}

// ---------------------------------------------------------------------------
// The compliance rule book. Sources and fixes live in docs/compliance.md; the
// SQL here and the words there change together (that is what /customise is for).

const RULES = [
  {
    key: 'worktime',
    title: 'Driver work time inside the logbook rules, last 14 days',
    source: 'Land Transport Rule: Work Time and Logbooks 2007, under Part 4B of the Land Transport Act 1998: at most 5.5 hours of continuous work before a 30 minute rest break, at most 13 hours of work time in a cumulative work day.',
    fix: 'A break that was taken but never recorded: `run break <run> <minutes>`. A day genuinely over the limits is a scheduling problem to fix forward, not a record to edit.',
    sql: `select dd.driver, dd.run_date, dd.runs, dd.work_minutes, dd.break_minutes,
                 case when dd.work_minutes > 780 then 'over 13h work' else 'no recorded break on a 5.5h+ run' end as breach
          from v_driver_day dd
          where dd.run_date >= now()::date - 14 and (dd.work_minutes > 780 or dd.no_break_run)`,
  },
  {
    key: 'fleet-certs',
    title: 'Every vehicle inside its COF and registration',
    source: 'Heavy vehicles carry a Certificate of Fitness renewed six-monthly (Land Transport Rule: Vehicle Standards Compliance 2002); operating without a current COF or registration is an offence and voids the operator licence conditions.',
    fix: 'Book the inspection, then `vehicle cof <fleet> --done=<date>` (the next due date is set six months out) and `vehicle rego <fleet> --due=<date>` when the licence is renewed.',
    sql: `select f.fleet_no, f.rego, f.description, f.cof_due_on, f.cof_days, f.rego_due_on, f.rego_days
          from v_fleet f
          where f.active and ((f.cof_days is not null and f.cof_days < 0) or (f.rego_days is not null and f.rego_days < 0))`,
  },
  {
    key: 'ruc',
    title: 'RUC licence distance ahead of the hubodometer on every diesel vehicle',
    source: 'Road User Charges Act 2012: a RUC vehicle must have a distance licence covering its current hubodometer reading. Driving past the licence distance is an offence with assessments and penalties behind it.',
    fix: 'Buy the next distance block, then `vehicle ruc <fleet> --to-km=<km>`. Keep hubodometer readings current with `vehicle hubo <fleet> <km>`. The check flags under 1,000 km of headroom.',
    sql: `select f.fleet_no, f.rego, f.hubodometer_km, f.ruc_paid_to_km, f.ruc_remaining_km
          from v_fleet f
          where f.active and f.ruc_remaining_km is not null and f.ruc_remaining_km < 1000`,
  },
  {
    key: 'dangerous-goods',
    title: 'Dangerous goods only with drivers who hold the D endorsement',
    source: 'Land Transport Rule: Dangerous Goods 2005: transporting dangerous goods for hire or reward requires a driver with a D endorsement on their licence, correct documentation and segregation. The endorsement is on the driver, not the truck.',
    fix: 'Move the consignment to an endorsed driver\'s run: `assign <con> <run>` (the gate refuses unendorsed runs on new assignments). Endorsements earned: `add driver` sets --dg, or update the driver record.',
    sql: `select b.con_no, b.customer, r.run_no, d.full_name as driver,
                 (select dg_class from consignments where id = b.id) as dg_class
          from v_board b
          join runs r on r.run_no = b.run_no
          join drivers d on d.id = r.driver_id
          where b.dangerous_goods and not d.dg_endorsed and b.status in ('assigned', 'picked-up')`,
  },
  {
    key: 'loading',
    title: 'No run loaded past the vehicle\'s rated payload',
    source: 'Land Transport Rule: Vehicle Dimensions and Mass 2016, with overloading offences under the Land Transport Act 1998: axle and gross limits are absolute, and the operator wears the infringement, not just the driver.',
    fix: 'Move freight to another run (`assign <con> <run>`) or a bigger vehicle (`run create`). The gate refuses new assignments that would overload; this check catches what was inherited or forced.',
    sql: `select rb.run_no, rb.run_date, rb.driver, rb.fleet_no, rb.load_kg, rb.max_payload_kg, rb.load_pct
          from v_run_board rb
          where rb.status in ('planned', 'out') and rb.max_payload_kg > 0 and rb.load_kg > rb.max_payload_kg`,
  },
  {
    key: 'claims-window',
    title: 'Cargo claims decided inside the Act\'s windows',
    source: 'Contract and Commercial Law Act 2017 Part 5 (carriage of goods): default carriage is at limited carrier\'s risk, liability capped at $2,000 per unit of goods, with notice and limitation windows around claims (30 days for notice of intention to claim, 12 months to sue). A claim left open is a relationship and a legal position both rotting.',
    fix: 'Decide it: `claim decide <claim> --accept|--decline --note="..."`, then `claim settle <claim> --amount=` when it is paid. The check flags open claims undecided after 14 days.',
    sql: `select cl.claim_no, cu.name as customer, c.con_no, cl.kind, cl.claimed_cents / 100.0 as claimed,
                 cl.opened_on, (now()::date - cl.opened_on) as days_open
          from claims cl
          join consignments c on c.id = cl.consignment_id
          join customers cu on cu.id = c.customer_id
          where cl.status = 'open' and (now()::date - cl.opened_on) > 14`,
  },
];

// ---------------------------------------------------------------------------
// Reads

const ATTENTION_WORDS = {
  dg_unendorsed: 'DANGEROUS GOODS, UNENDORSED DRIVER',
  overloaded_run: 'Run over the rated payload',
  worktime_breach: 'Work time breach',
  fleet_cert_due: 'COF or rego due',
  ruc_low: 'RUC licence nearly out',
  late_delivery: 'Past the required date',
  consignment_stuck: 'Booked, on no run',
  pod_missing: 'Delivered, no signed POD',
  exception_no_claim: 'Exception at the door, no claim',
  unbilled_delivered: 'POD in hand, not billed',
  rate_missing: 'No rate: moving for $0',
  claim_open: 'Cargo claim undecided',
  invoice_overdue: 'Invoice overdue',
  invoice_draft: 'Draft never sent',
  over_credit_limit: 'Over the credit limit',
  task_overdue: 'Task overdue',
};
const ATTENTION_ORDER = Object.keys(ATTENTION_WORDS);

async function cmdAttention(db) {
  const rows = await db.query('select * from v_attention');
  rows.sort((a, b) => ATTENTION_ORDER.indexOf(a.reason) - ATTENTION_ORDER.indexOf(b.reason) || num(b.days) - num(a.days));
  out(rows, () => {
    if (!rows.length) return 'Nothing needs attention. Enjoy it while it lasts.';
    const counts = {};
    for (const r of rows) counts[r.reason] = (counts[r.reason] || 0) + 1;
    const summary = Object.entries(counts).map(([k, v]) => `${ATTENTION_WORDS[k]}: ${v}`).join('  |  ');
    return heading(`Needs attention (${rows.length})`) + `\n  ${summary}\n\n` + table(rows, [
      { key: 'reason', label: 'What', format: (v) => ATTENTION_WORDS[v] || v, width: 30 },
      { key: 'label', label: 'Record', width: 26 },
      { key: 'customer', label: 'Customer', width: 25 },
      { key: 'who', label: 'Who', width: 14 },
      { key: 'days', label: 'Days', align: 'right' },
      { key: 'amount_cents', label: 'Value', align: 'right', format: (v) => (num(v) > 0 ? money(v) : '') },
      { key: 'detail', label: 'Detail', width: 44 },
    ]);
  });
}

async function cmdBoard(db, flags) {
  const cu = flags.customer ? await resolve(db, 'customer', flags.customer) : null;
  const where = [];
  const params = [];
  if (!flags.all) where.push("status not in ('delivered', 'cancelled')");
  if (cu) { params.push(cu.id); where.push(`customer_id = $${params.length}`); }
  const rows = await db.query(
    `select * from v_board ${where.length ? 'where ' + where.join(' and ') : ''}
     order by case status when 'picked-up' then 0 when 'assigned' then 1 when 'booked' then 2 when 'on-hold' then 3 else 4 end,
              required_by nulls last, con_no`,
    params,
  );
  out(rows, () => heading(`Consignments (${rows.length}${flags.all ? '' : ' open'})`) + '\n' + table(rows, [
    { key: 'con_no', label: 'Con' },
    { key: 'customer', label: 'Customer', width: 26, format: (v, r) => v + (r.on_stop ? ' [STOP]' : '') },
    { key: 'origin_zone', label: 'From' },
    { key: 'dest_zone', label: 'To' },
    { key: 'service', label: 'Service' },
    { key: 'weight_kg', label: 'Kg', align: 'right' },
    { key: 'dangerous_goods', label: 'DG', format: (v) => (v ? 'DG' : '') },
    { key: 'status', label: 'Status' },
    { key: 'required_by', label: 'Required', format: (v, r) => isoDate(v) + (num(r.days_late) > 0 ? ` (${r.days_late}d LATE)` : '') },
    { key: 'run_no', label: 'Run' },
    { key: 'charge_cents', label: 'Charge', align: 'right', format: (v, r) => (r.rate_desc ? money(v) : 'NO RATE') },
  ]));
}

async function cmdCon(db, ref) {
  const c = await resolve(db, 'con', ref);
  const [run] = c.run_id ? await db.query('select * from v_run_board where id = $1', [c.run_id]) : [null];
  const claims = await db.query('select * from claims where consignment_id = $1 order by opened_on', [c.id]);
  const [inv] = c.invoice_id ? await db.query('select number, status, issued_on, total_cents from invoices where id = $1', [c.invoice_id]) : [null];
  const notes = await db.query('select body, created_at from notes where consignment_id = $1 order by created_at desc', [c.id]);
  out({ con: c, run, claims, invoice: inv, notes }, () => {
    const lines = [heading(`${c.con_no}  ${c.customer_name}${c.on_stop ? ' [ON STOP]' : ''} (${c.status})`)];
    lines.push(`  ${c.origin_zone} to ${c.dest_zone}, ${c.service}. ${c.items} items, ${c.pallets} pallets, ${c.weight_kg} kg.${c.dangerous_goods ? `  DANGEROUS GOODS class ${c.dg_class || '?'}.` : ''}`);
    lines.push(`  From: ${c.sender_name || '-'}, ${c.origin_address || '-'}`);
    lines.push(`  To:   ${c.receiver_name || '-'}, ${c.dest_address || '-'}`);
    if (c.instructions) lines.push(`  Instructions: ${c.instructions}`);
    lines.push(`  Booked ${isoDate(c.booked_on)}${c.customer_ref ? ` (their ref ${c.customer_ref})` : ''}, required ${isoDate(c.required_by) || 'open'}.`);
    lines.push(`  Charge: ${c.rate_desc ? `${money(c.charge_cents)} (${c.rate_desc})` : 'NO RATE MATCHED: $0'}`);
    if (run) lines.push(`  Run: ${run.run_no} ${run.name || ''} ${isoDate(run.run_date)}, ${run.driver || 'no driver'} in ${run.fleet_no || '?'}, drop ${c.drop_order || '?'}.`);
    if (c.picked_up_at) lines.push(`  Picked up ${isoDate(c.picked_up_at)}.`);
    if (c.delivered_at) {
      lines.push(`  Delivered ${isoDate(c.delivered_at)}. POD: ${c.pod_name ? `${c.pod_name} at ${isoDate(c.pod_at)}` : 'MISSING'}.`);
      if (c.exception) lines.push(`  EXCEPTION: ${c.exception}${c.exception_note ? ` (${c.exception_note})` : ''}`);
      lines.push(`  Billing: ${inv ? `${inv.number} (${inv.status}, ${money(inv.total_cents)})` : c.pod_name ? 'unbilled, POD in hand' : 'BLOCKED: no POD'}`);
    }
    for (const cl of claims) lines.push(`  Claim ${cl.claim_no}: ${cl.kind} ${money(cl.claimed_cents)} (${cl.status})`);
    for (const n of notes) lines.push(`  Note ${isoDate(n.created_at)}: ${n.body}`);
    return lines.join('\n');
  });
}

async function cmdRuns(db, flags) {
  const where = flags.all ? '' : `where r.run_date >= now()::date - ${flags.date ? 0 : 7}`;
  const params = [];
  let sql = `select * from v_run_board rb ${flags.all ? '' : 'where rb.run_date >= now()::date - 7'}`;
  if (flags.date) {
    params.push(parseDate(flags.date));
    sql = `select * from v_run_board rb where rb.run_date = $1`;
  }
  const rows = await db.query(sql + ' order by rb.run_date, rb.run_no', params);
  out(rows, () => heading(`Runs (${rows.length})`) + '\n' + table(rows, [
    { key: 'run_no', label: 'Run' },
    { key: 'run_date', label: 'Date', format: isoDate },
    { key: 'name', label: 'Name', width: 18 },
    { key: 'driver', label: 'Driver', width: 16 },
    { key: 'fleet_no', label: 'Truck' },
    { key: 'status', label: 'Status' },
    { key: 'stops', label: 'Stops', align: 'right' },
    { key: 'load_kg', label: 'Load kg', align: 'right' },
    { key: 'load_pct', label: 'Of payload', align: 'right', format: (v) => (v === null || v === undefined ? '' : `${v}%${num(v) > 100 ? ' OVER' : ''}`) },
    { key: 'has_dg', label: 'DG', format: (v) => (v ? 'DG' : '') },
    { key: 'span_minutes', label: 'Span', format: (v, r) => (v ? `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}${r.break_minutes ? ` (-${r.break_minutes}m brk)` : ' NO BREAK'}` : '') },
  ]));
}

async function cmdRun(db, args, flags) {
  const sub = args[0];
  if (sub === 'create') {
    const driver = flags.driver ? await resolve(db, 'driver', flags.driver) : null;
    const vehicle = flags.vehicle ? await resolve(db, 'vehicle', flags.vehicle) : null;
    const run_no = await nextRef(db, 'runs', 'run_no', 'RUN', 400);
    const date = parseDate(flags.date) || today();
    await db.query(
      'insert into runs (run_no, name, run_date, driver_id, vehicle_id) values ($1, $2, $3, $4, $5)',
      [run_no, str(flags.name) || null, date, driver?.id || null, vehicle?.id || null],
    );
    out({ run_no, run_date: date, driver: driver?.full_name, vehicle: vehicle?.fleet_no },
      `Created ${run_no} on ${date}${driver ? `, ${driver.full_name}` : ''}${vehicle ? ` in ${vehicle.fleet_no}` : ''}.`);
    return;
  }
  if (sub === 'depart' || sub === 'return' || sub === 'break') {
    const r = await resolve(db, 'run', args[1]);
    if (sub === 'depart') {
      const at = parseWhen(flags.at);
      await db.query("update runs set status = 'out', depart_at = $2 where id = $1", [r.id, at]);
      out({ run_no: r.run_no, depart_at: at }, `${r.run_no} out at ${at}.`);
    } else if (sub === 'return') {
      if (!r.depart_at) throw new CliError(`${r.run_no} never departed. \`run depart ${r.run_no}\` first.`);
      const at = parseWhen(flags.at);
      const brk = flags.break !== undefined ? parseQty(flags.break, 'number of minutes') : r.break_minutes;
      await db.query("update runs set status = 'done', return_at = $2, break_minutes = $3 where id = $1", [r.id, at, brk]);
      const [dd] = await db.query('select * from v_driver_day where driver_id = $1 and run_date = $2', [r.driver_id, r.run_date]);
      const warn = dd && (num(dd.work_minutes) > 780 || dd.no_break_run)
        ? `  WORK TIME: ${(num(dd.work_minutes) / 60).toFixed(1)}h net${dd.no_break_run ? ', no recorded break on a 5.5h+ run' : ''}. The logbook rules are breached; see /compliance.`
        : '';
      out({ run_no: r.run_no, return_at: at, break_minutes: brk, worktime_warning: Boolean(warn) }, `${r.run_no} done at ${at}.${warn ? '\n' + warn : ''}`);
    } else {
      const minutes = parseQty(args[2] ?? flags.minutes, 'number of minutes');
      if (!minutes) throw new CliError('How many minutes of break? `run break <run> 30`');
      await db.query('update runs set break_minutes = $2 where id = $1', [r.id, minutes]);
      out({ run_no: r.run_no, break_minutes: minutes }, `${r.run_no}: ${minutes} minutes of break recorded.`);
    }
    return;
  }
  // one run: the manifest
  const r = await resolve(db, 'run', sub);
  const [rb] = await db.query('select * from v_run_board where id = $1', [r.id]);
  const stops = await db.query(
    `select c.drop_order, c.con_no, cu.name as customer, c.receiver_name, c.dest_address, c.dest_zone,
            c.items, c.pallets, c.weight_kg, c.dangerous_goods, c.dg_class, c.instructions, c.status
     from consignments c join customers cu on cu.id = c.customer_id
     where c.run_id = $1 and c.status <> 'cancelled' order by c.drop_order nulls last, c.con_no`,
    [r.id],
  );
  out({ run: rb, stops }, () => {
    const head = heading(`${rb.run_no}  ${rb.name || ''} ${isoDate(rb.run_date)} (${rb.status})`);
    const meta = `  ${rb.driver || 'NO DRIVER'} in ${rb.fleet_no || 'NO VEHICLE'}. ${rb.stops} stops, ${rb.load_kg} kg${rb.max_payload_kg ? ` of ${rb.max_payload_kg} kg (${rb.load_pct}%${num(rb.load_pct) > 100 ? ' OVERLOADED' : ''})` : ''}.${rb.has_dg ? ' CARRIES DANGEROUS GOODS.' : ''}`;
    return head + '\n' + meta + '\n\n' + table(stops, [
      { key: 'drop_order', label: '#', align: 'right' },
      { key: 'con_no', label: 'Con' },
      { key: 'customer', label: 'Customer', width: 24 },
      { key: 'receiver_name', label: 'Deliver to', width: 26 },
      { key: 'dest_address', label: 'Address', width: 30 },
      { key: 'weight_kg', label: 'Kg', align: 'right' },
      { key: 'dangerous_goods', label: 'DG', format: (v, row) => (v ? `DG ${row.dg_class || ''}` : '') },
      { key: 'status', label: 'Status' },
      { key: 'instructions', label: 'Instructions', width: 30 },
    ]);
  });
}

// ---------------------------------------------------------------------------
// Booking and the consignment lifecycle

async function cmdBook(db, args, flags) {
  const cu = await resolve(db, 'customer', args[0]);
  if (cu.on_stop) throw new CliError(`${cu.name} is ON STOP${cu.note ? ` (${cu.note})` : ''}. New bookings need the operator's own call; the refusal is the credit policy working.`);
  const origin = str(flags['from-zone'] || flags.from);
  const dest = str(flags['to-zone'] || flags.to);
  if (!origin || !dest) throw new CliError('Where is it going? --from-zone= and --to-zone= (zone codes like PMR, WLG, AKL).');
  const service = str(flags.service) || 'general';
  const weight_kg = parseQty(flags.weight, 'weight in kg');
  const pallets = parseQty(flags.pallets, 'pallet count');
  const items = parseQty(flags.items, 'item count') || 1;
  const con_no = await nextRef(db, 'consignments', 'con_no', 'CON', 1300);

  let charge_cents = 0;
  let rate_desc = null;
  if (flags.charge !== undefined) {
    charge_cents = parseMoney(flags.charge);
    rate_desc = 'Manual charge at booking';
  } else {
    const rate = await findRate(db, cu.id, origin, dest, service);
    if (rate) ({ charge_cents, rate_desc } = applyRate(rate, { weight_kg, pallets, items }));
  }

  await db.query(
    `insert into consignments (con_no, customer_id, customer_ref, sender_name, origin_address, origin_zone,
       receiver_name, dest_address, dest_zone, service, items, pallets, weight_kg, cubic_m,
       dangerous_goods, dg_class, instructions, required_by, charge_cents, rate_desc)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [con_no, cu.id, str(flags.ref) || null, str(flags.sender) || cu.name, str(flags['origin-address']) || null, origin.toUpperCase(),
      str(flags.receiver) || null, str(flags['dest-address']) || null, dest.toUpperCase(), service, items, pallets, weight_kg,
      flags.cubic !== undefined ? parseQty(flags.cubic, 'cubic metres') : null,
      Boolean(flags.dg), str(flags['dg-class']) || null, str(flags.instructions) || null,
      parseDate(flags.required), charge_cents, rate_desc],
  );
  const warn = rate_desc ? '' : `  NO RATE CARD matches ${origin.toUpperCase()} to ${dest.toUpperCase()} ${service}: booked at $0. Add the lane (\`rate add\`) then \`rerate ${con_no}\`, or set --charge=.`;
  out({ con_no, customer: cu.name, charge_cents, rate_desc, rate_missing: !rate_desc },
    `Booked ${con_no} for ${cu.name}: ${origin.toUpperCase()} to ${dest.toUpperCase()}, ${weight_kg} kg. Charge ${money(charge_cents)}${rate_desc ? ` (${rate_desc})` : ''}.${warn ? '\n' + warn : ''}`);
}

async function cmdAssign(db, args, flags) {
  const c = await resolve(db, 'con', args[0]);
  const r = await resolve(db, 'run', args[1]);
  if (['delivered', 'cancelled'].includes(c.status)) throw new CliError(`${c.con_no} is ${c.status}: nothing to assign.`);
  if (c.status === 'on-hold') throw new CliError(`${c.con_no} is on hold. \`release ${c.con_no}\` first: the hold is a decision, not a queue.`);
  if (c.dangerous_goods && !r.driver_dg_endorsed) {
    throw new CliError(
      `${c.con_no} is dangerous goods (class ${c.dg_class || '?'}) and ${r.driver_name || 'the driver'} holds no D endorsement ` +
      `(Land Transport Rule: Dangerous Goods 2005). Put it on an endorsed driver's run.`,
    );
  }
  const [{ load_kg }] = await db.query(
    `select coalesce(sum(weight_kg), 0) as load_kg from consignments where run_id = $1 and status <> 'cancelled' and id <> $2`,
    [r.id, c.id],
  );
  const newLoad = num(load_kg) + num(c.weight_kg);
  if (num(r.max_payload_kg) > 0 && newLoad > num(r.max_payload_kg) && !flags.force) {
    throw new CliError(
      `That puts ${newLoad} kg on ${r.fleet_no}, rated ${r.max_payload_kg} kg (Land Transport Rule: Vehicle Dimensions and Mass 2016). ` +
      `Another run, a bigger truck, or --force if the rating is wrong in the record.`,
    );
  }
  const drop = flags.drop !== undefined ? parseQty(flags.drop, 'drop order')
    : num((await db.query('select coalesce(max(drop_order), 0) + 1 as d from consignments where run_id = $1', [r.id]))[0].d);
  await db.query("update consignments set run_id = $2, drop_order = $3, status = 'assigned' where id = $1", [c.id, r.id, drop]);
  out({ con_no: c.con_no, run_no: r.run_no, drop_order: drop, load_kg: newLoad },
    `${c.con_no} onto ${r.run_no} at drop ${drop}. Run load ${newLoad} kg${num(r.max_payload_kg) ? ` of ${r.max_payload_kg} kg` : ''}.`);
}

async function cmdPickup(db, args, flags) {
  const c = await resolve(db, 'con', args[0]);
  if (!['booked', 'assigned'].includes(c.status)) throw new CliError(`${c.con_no} is ${c.status}.`);
  const at = parseWhen(flags.at);
  await db.query("update consignments set status = 'picked-up', picked_up_at = $2 where id = $1", [c.id, at]);
  out({ con_no: c.con_no, picked_up_at: at }, `${c.con_no} picked up at ${at}.`);
}

async function cmdDeliver(db, args, flags) {
  const c = await resolve(db, 'con', args[0]);
  if (['delivered', 'cancelled'].includes(c.status)) throw new CliError(`${c.con_no} is already ${c.status}.`);
  if (c.status === 'on-hold') throw new CliError(`${c.con_no} is on hold. \`release ${c.con_no}\` first.`);
  const podName = str(flags.pod);
  if (!podName && !flags['no-pod']) {
    throw new CliError(
      `Who signed? --pod="Name" is the proof of delivery that billing stands on. ` +
      `Genuinely unsigned (left at door, ATL): --no-pod records the gap loudly instead of quietly.`,
    );
  }
  const at = parseWhen(flags.at);
  const exception = str(flags.exception) || null;
  if (exception && !['damage', 'shortage', 'refused'].includes(exception)) throw new CliError('--exception is damage, shortage or refused.');
  await db.query(
    `update consignments set status = 'delivered', delivered_at = $2,
       pod_name = $3, pod_at = $4, exception = $5, exception_note = $6 where id = $1`,
    [c.id, at, podName || null, podName ? at : null, exception, str(flags.note) || null],
  );
  const warn = [];
  if (!podName) warn.push(`No POD recorded: ${c.con_no} cannot bill until \`pod ${c.con_no} --name=\` backfills the signature.`);
  if (exception) warn.push(`Exception at the door (${exception}). If the customer claims, open it: \`claim open ${c.con_no} --kind=${exception === 'refused' ? 'damage' : exception} --amount=\`.`);
  out({ con_no: c.con_no, delivered_at: at, pod_name: podName || null, exception },
    `${c.con_no} delivered at ${at}${podName ? `, signed ${podName}` : ''}.${warn.length ? '\n  ' + warn.join('\n  ') : ''}`);
}

async function cmdPod(db, args, flags) {
  const c = await resolve(db, 'con', args[0]);
  if (c.status !== 'delivered') throw new CliError(`${c.con_no} is ${c.status}, not delivered.`);
  const name = str(flags.name);
  if (!name) throw new CliError('Whose signature? --name="R. Aporo". The name comes off the paperwork or the app; never invent one.');
  const at = flags.at ? parseWhen(flags.at) : (c.delivered_at ? new Date(c.delivered_at).toISOString() : new Date().toISOString());
  await db.query('update consignments set pod_name = $2, pod_at = $3 where id = $1', [c.id, name, at]);
  out({ con_no: c.con_no, pod_name: name, pod_at: at }, `${c.con_no}: POD recorded, ${name}. It can bill now.`);
}

async function cmdPods(db) {
  const rows = await db.query('select * from v_pod_gap order by days_waiting desc');
  out(rows, () => heading(`Delivered with no signed POD (${rows.length})`) +
    (rows.length ? '\n  Billing is blocked on every row here. Chase the driver or the app, then `pod <con> --name=`.\n' : '') +
    '\n' + table(rows, [
      { key: 'con_no', label: 'Con' },
      { key: 'customer', label: 'Customer', width: 28 },
      { key: 'receiver_name', label: 'Delivered to', width: 26 },
      { key: 'delivered_at', label: 'Delivered', format: isoDate },
      { key: 'days_waiting', label: 'Days', align: 'right' },
      { key: 'run_no', label: 'Run' },
      { key: 'driver', label: 'Driver', width: 16 },
      { key: 'charge_cents', label: 'Blocked', align: 'right', format: (v) => money(v) },
    ]));
}

async function cmdHold(db, args, flags) {
  const c = await resolve(db, 'con', args[0]);
  const reason = str(flags.reason);
  if (!reason) throw new CliError('Why? --reason= goes on the record; a hold with no reason is freight nobody can release.');
  await db.query("update consignments set status = 'on-hold', note = coalesce(note || ' | ', '') || $2 where id = $1", [c.id, `On hold: ${reason}`]);
  out({ con_no: c.con_no, reason }, `${c.con_no} on hold: ${reason}`);
}

async function cmdRelease(db, args) {
  const c = await resolve(db, 'con', args[0]);
  if (c.status !== 'on-hold') throw new CliError(`${c.con_no} is ${c.status}, not on hold.`);
  const status = c.run_id ? 'assigned' : 'booked';
  await db.query('update consignments set status = $2 where id = $1', [c.id, status]);
  out({ con_no: c.con_no, status }, `${c.con_no} released: ${status}.`);
}

async function cmdCancel(db, args, flags) {
  const c = await resolve(db, 'con', args[0]);
  if (c.status === 'delivered') throw new CliError(`${c.con_no} is delivered. History does not cancel; credit the invoice in your accounting system if it must unwind.`);
  const reason = str(flags.reason);
  if (!reason) throw new CliError('Why? --reason= goes on the record.');
  await db.query("update consignments set status = 'cancelled', run_id = null, note = coalesce(note || ' | ', '') || $2 where id = $1", [c.id, `Cancelled: ${reason}`]);
  out({ con_no: c.con_no, reason }, `${c.con_no} cancelled: ${reason}`);
}

// ---------------------------------------------------------------------------
// Rates

async function cmdRates(db, args) {
  const cu = args[0] ? await resolve(db, 'customer', args[0]) : null;
  const rows = await db.query(
    `select r.*, cu.name as customer from rate_cards r left join customers cu on cu.id = r.customer_id
     ${cu ? 'where r.customer_id = $1 or r.customer_id is null' : ''}
     order by cu.name nulls first, r.origin_zone, r.dest_zone, r.service`,
    cu ? [cu.id] : [],
  );
  out(rows, () => heading(`Rate cards (${rows.length})`) + '\n' + table(rows, [
    { key: 'customer', label: 'Card', format: (v) => v || 'Standard tariff', width: 28 },
    { key: 'origin_zone', label: 'From' },
    { key: 'dest_zone', label: 'To' },
    { key: 'service', label: 'Service' },
    { key: 'basis', label: 'Basis', format: (v) => v.replace('_', ' ') },
    { key: 'rate_cents', label: 'Rate', align: 'right', format: (v, r) => (r.basis === 'per_kg' ? `${v}c/kg` : money(v)) },
    { key: 'min_charge_cents', label: 'Min', align: 'right', format: (v) => money(v) },
    { key: 'effective_on', label: 'Since', format: isoDate },
  ]));
}

async function cmdRateAdd(db, args, flags) {
  const [origin, dest] = args;
  if (!origin || !dest) throw new CliError('rate add <from-zone> <to-zone> --rate= [--basis=per_kg|per_pallet|per_item] [--min=] [--service=] [--customer=]');
  const cu = flags.customer ? await resolve(db, 'customer', flags.customer) : null;
  const basis = str(flags.basis) || 'per_kg';
  if (!['per_kg', 'per_pallet', 'per_item'].includes(basis)) throw new CliError('--basis is per_kg, per_pallet or per_item.');
  const rate_cents = basis === 'per_kg' ? Math.round(Number(str(flags.rate))) : parseMoney(flags.rate);
  if (!rate_cents || Number.isNaN(rate_cents)) throw new CliError(basis === 'per_kg' ? 'What rate? --rate= in cents per kg (18 means 18c/kg).' : 'What rate? --rate= in dollars.');
  await db.query(
    `insert into rate_cards (customer_id, origin_zone, dest_zone, service, basis, rate_cents, min_charge_cents)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [cu?.id || null, origin.toUpperCase(), dest.toUpperCase(), str(flags.service) || 'general', basis, rate_cents, parseMoney(flags.min)],
  );
  out({ card: cu?.name || 'standard', origin: origin.toUpperCase(), dest: dest.toUpperCase(), basis, rate_cents },
    `${cu ? cu.name + ' card' : 'Standard'}: ${origin.toUpperCase()} to ${dest.toUpperCase()} at ${basis === 'per_kg' ? rate_cents + 'c/kg' : money(rate_cents) + ' ' + basis.replace('_', ' ')}.`);
}

async function cmdRateCheck(db) {
  const rows = await db.query('select * from v_rate_gap order by booked_on');
  out(rows, () => heading(`No rate matched (${rows.length})`) +
    (rows.length ? '\n  These are moving for $0. `rate add <from> <to> --rate=` then `rerate <con>`.\n' : '') +
    '\n' + table(rows, [
      { key: 'con_no', label: 'Con' },
      { key: 'customer', label: 'Customer', width: 28 },
      { key: 'origin_zone', label: 'From' },
      { key: 'dest_zone', label: 'To' },
      { key: 'service', label: 'Service' },
      { key: 'weight_kg', label: 'Kg', align: 'right' },
      { key: 'status', label: 'Status' },
      { key: 'booked_on', label: 'Booked', format: isoDate },
    ]));
}

async function cmdRerate(db, args) {
  const c = await resolve(db, 'con', args[0]);
  if (c.invoice_id) throw new CliError(`${c.con_no} is already invoiced. The price on an invoice does not quietly change; credit and re-bill if it is wrong.`);
  const rate = await findRate(db, c.customer_id, c.origin_zone, c.dest_zone, c.service);
  if (!rate) throw new CliError(`Still no card for ${c.origin_zone} to ${c.dest_zone} ${c.service}. \`rate add\` first.`);
  const { charge_cents, rate_desc } = applyRate(rate, c);
  await db.query('update consignments set charge_cents = $2, rate_desc = $3 where id = $1', [c.id, charge_cents, rate_desc]);
  out({ con_no: c.con_no, charge_cents, rate_desc }, `${c.con_no} rated ${money(charge_cents)} (${rate_desc}).`);
}

// ---------------------------------------------------------------------------
// Billing

async function cmdBill(db, args, flags) {
  const cu = args[0] ? await resolve(db, 'customer', args[0]) : null;
  const rows = await db.query(
    `select u.*, cu.terms_days, cu.fuel_levy_pct from v_unbilled u join customers cu on cu.id = u.customer_id
     ${cu ? 'where u.customer_id = $1' : ''} order by u.customer, u.delivered_at`,
    cu ? [cu.id] : [],
  );
  if (!rows.length) {
    const blocked = await db.query(`select count(*)::int as n from v_pod_gap ${cu ? 'p where exists (select 1 from consignments c where c.id = p.id and c.customer_id = $1)' : ''}`, cu ? [cu.id] : []);
    throw new CliError(`Nothing billable${cu ? ` for ${cu.name}` : ''}.${num(blocked[0]?.n) ? ` ${blocked[0].n} delivered consignment(s) are blocked on a missing POD: \`pods\`.` : ''}`);
  }
  const byCustomer = new Map();
  for (const r of rows) {
    if (!byCustomer.has(r.customer_id)) byCustomer.set(r.customer_id, []);
    byCustomer.get(r.customer_id).push(r);
  }
  const invoices = [];
  for (const [customerId, cons] of byCustomer) {
    const freight = cons.reduce((s, c) => s + num(c.charge_cents), 0);
    const levyPct = Number(cons[0].fuel_levy_pct || 0);
    const levy = Math.round(freight * levyPct / 100);
    const total = freight + levy;
    const number = await nextRef(db, 'invoices', 'number', 'INV', 2000);
    const issued = today();
    const due = addDays(issued, num(cons[0].terms_days) || 20);
    if (!flags['dry-run']) {
      const [inv] = await db.query(
        `insert into invoices (number, customer_id, issued_on, due_on, status, total_cents) values ($1, $2, $3, $4, 'draft', $5) returning id`,
        [number, customerId, issued, due, total],
      );
      for (const c of cons) {
        await db.query(
          'insert into invoice_lines (invoice_id, consignment_id, description, amount_cents) values ($1, $2, $3, $4)',
          [inv.id, c.id, `${c.con_no} ${c.rate_desc || 'freight'}, delivered ${isoDate(c.delivered_at)}`, c.charge_cents],
        );
        await db.query('update consignments set invoice_id = $2 where id = $1', [c.id, inv.id]);
      }
      if (levy) await db.query('insert into invoice_lines (invoice_id, description, amount_cents) values ($1, $2, $3)', [inv.id, `Fuel levy ${levyPct}%`, levy]);
    }
    invoices.push({ number, customer: cons[0].customer, consignments: cons.length, freight_cents: freight, levy_cents: levy, total_cents: total, due_on: due });
  }
  out({ dry_run: Boolean(flags['dry-run']), invoices }, () =>
    heading(`${flags['dry-run'] ? 'Would draft' : 'Drafted'} ${invoices.length} invoice(s)`) + '\n' + table(invoices, [
      { key: 'number', label: 'Invoice' },
      { key: 'customer', label: 'Customer', width: 30 },
      { key: 'consignments', label: 'Cons', align: 'right' },
      { key: 'freight_cents', label: 'Freight', align: 'right', format: (v) => money(v) },
      { key: 'levy_cents', label: 'Fuel levy', align: 'right', format: (v) => (v ? money(v) : '') },
      { key: 'total_cents', label: 'Total', align: 'right', format: (v) => money(v) },
      { key: 'due_on', label: 'Due' },
    ]) + '\n\n  Drafts only. Render with `npm run docs`, check, send from your own system, then `invoice sent <number>`.');
}

async function cmdInvoices(db, flags) {
  const rows = await db.query(
    `select * from v_debtors ${flags.all ? '' : ''} order by issued_on desc`,
  );
  const all = flags.all ? await db.query(`select i.number, cu.name as customer, i.issued_on, i.due_on, i.status, i.total_cents, null::int as days_overdue, null::text as bucket from invoices i join customers cu on cu.id = i.customer_id where i.status = 'paid' order by i.issued_on desc`) : [];
  const list = [...rows, ...all];
  out(list, () => heading(`Invoices (${list.length}${flags.all ? '' : ' unpaid'})`) + '\n' + table(list, [
    { key: 'number', label: 'Invoice' },
    { key: 'customer', label: 'Customer', width: 30 },
    { key: 'issued_on', label: 'Issued', format: isoDate },
    { key: 'due_on', label: 'Due', format: isoDate },
    { key: 'status', label: 'Status' },
    { key: 'total_cents', label: 'Total', align: 'right', format: (v) => money(v) },
    { key: 'days_overdue', label: 'Overdue', align: 'right', format: (v) => (num(v) > 0 ? `${v}d` : '') },
  ]));
}

async function cmdInvoice(db, args, flags) {
  const sub = args[0];
  if (sub === 'sent' || sub === 'paid') {
    const inv = await resolve(db, 'invoice', args[1]);
    if (sub === 'sent' && inv.status !== 'draft') throw new CliError(`${inv.number} is ${inv.status}, not draft.`);
    if (sub === 'paid' && inv.status !== 'sent') throw new CliError(`${inv.number} is ${inv.status}. Only a sent invoice gets paid; \`invoice sent ${inv.number}\` first if it truly went out.`);
    await db.query('update invoices set status = $2 where id = $1', [inv.id, sub]);
    out({ number: inv.number, status: sub }, `${inv.number} marked ${sub}.`);
    return;
  }
  const inv = await resolve(db, 'invoice', sub);
  const lines = await db.query('select il.description, il.amount_cents, c.con_no from invoice_lines il left join consignments c on c.id = il.consignment_id where il.invoice_id = $1 order by il.created_at', [inv.id]);
  out({ invoice: inv, lines }, () =>
    heading(`${inv.number}  ${inv.customer_name} (${inv.status})`) +
    `\n  Issued ${isoDate(inv.issued_on)}, due ${isoDate(inv.due_on)}. Total ${money(inv.total_cents)}.\n\n` +
    table(lines, [
      { key: 'con_no', label: 'Con' },
      { key: 'description', label: 'Description', width: 60 },
      { key: 'amount_cents', label: 'Amount', align: 'right', format: (v) => money(v) },
    ]));
}

async function cmdDebtors(db) {
  const rows = await db.query('select * from v_debtors order by days_overdue desc nulls last, due_on');
  out(rows, () => heading(`Debtors (${rows.length} unpaid)`) + '\n' + table(rows, [
    { key: 'number', label: 'Invoice' },
    { key: 'customer', label: 'Customer', width: 30 },
    { key: 'total_cents', label: 'Total', align: 'right', format: (v) => money(v) },
    { key: 'status', label: 'Status' },
    { key: 'due_on', label: 'Due', format: isoDate },
    { key: 'bucket', label: 'Aged', format: (v, r) => (r.status === 'draft' ? 'NOT SENT' : v || '') },
    { key: 'days_overdue', label: 'Overdue', align: 'right', format: (v) => (num(v) > 0 ? `${v}d` : '') },
  ]));
}

// ---------------------------------------------------------------------------
// DIFOT, drivers, fleet

async function cmdDifot(db, args) {
  const cu = args[0] ? await resolve(db, 'customer', args[0]) : null;
  const rows = await db.query(`select * from v_difot ${cu ? 'where customer_id = $1' : ''} order by difot_pct, customer`, cu ? [cu.id] : []);
  out(rows, () => heading('DIFOT, last 28 days (delivered in full, on time)') + '\n' + table(rows, [
    { key: 'customer', label: 'Customer', width: 32 },
    { key: 'delivered', label: 'Delivered', align: 'right' },
    { key: 'on_time', label: 'On time', align: 'right' },
    { key: 'in_full', label: 'In full', align: 'right' },
    { key: 'difot_pct', label: 'DIFOT', align: 'right', format: (v) => `${v}%` },
    { key: 'difot_pct', label: '', format: (v) => bar(v) },
  ]) + '\n\n  On time is against the required-by date; in full means no exception at the door. The stories behind the misses: `con <ref>`.');
}

async function cmdDrivers(db) {
  const rows = await db.query(
    `select d.*, (select count(*) from runs r where r.driver_id = d.id and r.run_date >= now()::date - 7) as runs_7d,
            (select coalesce(sum(dd.work_minutes), 0) from v_driver_day dd where dd.driver_id = d.id and dd.run_date >= now()::date - 7) as work_7d
     from drivers d where d.active order by d.full_name`,
  );
  out(rows, () => heading(`Drivers (${rows.length})`) + '\n' + table(rows, [
    { key: 'full_name', label: 'Driver', width: 20 },
    { key: 'code', label: 'Code' },
    { key: 'licence_class', label: 'Licence' },
    { key: 'dg_endorsed', label: 'DG', format: (v) => (v ? 'D endorsed' : '') },
    { key: 'base', label: 'Base', width: 18 },
    { key: 'runs_7d', label: 'Runs 7d', align: 'right' },
    { key: 'work_7d', label: 'Work 7d', align: 'right', format: (v) => `${(num(v) / 60).toFixed(1)}h` },
  ]));
}

async function cmdDriver(db, args) {
  const d = await resolve(db, 'driver', args[0]);
  const days = await db.query('select * from v_driver_day where driver_id = $1 order by run_date desc limit 14', [d.id]);
  const runs = await db.query(
    `select rb.run_no, rb.run_date, rb.name, rb.fleet_no, rb.status, rb.stops, rb.load_kg from v_run_board rb
     join runs r on r.id = rb.id where r.driver_id = $1 order by rb.run_date desc limit 10`,
    [d.id],
  );
  out({ driver: d, days, runs }, () =>
    heading(`${d.full_name}  ${d.licence_class}${d.dg_endorsed ? ', D endorsed' : ', no D endorsement'}`) +
    `\n  Base ${d.base || '-'}. ${d.phone || ''}\n\n` +
    'Work time, last 14 days\n' + table(days, [
      { key: 'run_date', label: 'Date', format: isoDate },
      { key: 'runs', label: 'Runs', align: 'right' },
      { key: 'work_minutes', label: 'Work', align: 'right', format: (v) => `${(num(v) / 60).toFixed(1)}h` },
      { key: 'break_minutes', label: 'Breaks', align: 'right', format: (v) => `${v}m` },
      { key: 'no_break_run', label: 'Flags', format: (v, r) => [num(r.work_minutes) > 780 ? 'OVER 13H' : '', v ? 'NO BREAK 5.5H+' : ''].filter(Boolean).join(', ') },
    ]) + '\n\nRecent runs\n' + table(runs, [
      { key: 'run_no', label: 'Run' },
      { key: 'run_date', label: 'Date', format: isoDate },
      { key: 'name', label: 'Name', width: 20 },
      { key: 'fleet_no', label: 'Truck' },
      { key: 'status', label: 'Status' },
      { key: 'stops', label: 'Stops', align: 'right' },
      { key: 'load_kg', label: 'Kg', align: 'right' },
    ]));
}

async function cmdHours(db, flags) {
  const days = flags.days !== undefined ? parseQty(flags.days, 'number of days') : 14;
  const rows = await db.query(`select * from v_driver_day where run_date >= now()::date - ${Math.max(1, days)} order by run_date desc, driver`);
  out(rows, () => heading(`Driver work time, last ${days} days`) + '\n' + table(rows, [
    { key: 'run_date', label: 'Date', format: isoDate },
    { key: 'driver', label: 'Driver', width: 20 },
    { key: 'runs', label: 'Runs', align: 'right' },
    { key: 'span_minutes', label: 'Span', align: 'right', format: (v) => (v ? `${(num(v) / 60).toFixed(1)}h` : '') },
    { key: 'break_minutes', label: 'Breaks', align: 'right', format: (v) => `${v}m` },
    { key: 'work_minutes', label: 'Work', align: 'right', format: (v) => `${(num(v) / 60).toFixed(1)}h` },
    { key: 'no_break_run', label: 'Flags', format: (v, r) => [num(r.work_minutes) > 780 ? 'OVER 13H' : '', v ? 'NO BREAK 5.5H+' : ''].filter(Boolean).join(', ') },
  ]) + '\n\n  The limits: 5.5h continuous work then a 30 minute break; 13h work in a cumulative day (Work Time and Logbooks Rule 2007). These records are what an inspector reads.');
}

async function cmdFleet(db) {
  const rows = await db.query('select * from v_fleet where active order by fleet_no');
  out(rows, () => heading(`Fleet (${rows.length})`) + '\n' + table(rows, [
    { key: 'fleet_no', label: 'Fleet' },
    { key: 'rego', label: 'Rego' },
    { key: 'description', label: 'Vehicle', width: 28 },
    { key: 'max_payload_kg', label: 'Payload', align: 'right', format: (v) => `${v} kg` },
    { key: 'cof_due_on', label: 'COF due', format: (v, r) => (v ? `${isoDate(v)}${num(r.cof_days) < 0 ? ` (${Math.abs(r.cof_days)}d OVERDUE)` : num(r.cof_days) <= 14 ? ` (${r.cof_days}d)` : ''}` : '') },
    { key: 'rego_due_on', label: 'Rego due', format: (v, r) => (v ? `${isoDate(v)}${num(r.rego_days) < 0 ? ` (${Math.abs(r.rego_days)}d OVERDUE)` : num(r.rego_days) <= 14 ? ` (${r.rego_days}d)` : ''}` : '') },
    { key: 'hubodometer_km', label: 'Hubo km', align: 'right' },
    { key: 'ruc_remaining_km', label: 'RUC left', align: 'right', format: (v, r) => (r.ruc_paid_to_km === null ? 'no RUC' : `${v} km${num(v) < 1000 ? ' LOW' : ''}`) },
  ]));
}

async function cmdVehicle(db, args, flags) {
  const sub = args[0];
  if (['cof', 'rego', 'ruc', 'hubo'].includes(sub)) {
    const v = await resolve(db, 'vehicle', args[1]);
    if (sub === 'cof') {
      const done = parseDate(flags.done) || today();
      const next = parseDate(flags.next) || addDays(done, 182);
      await db.query('update vehicles set cof_due_on = $2 where id = $1', [v.id, next]);
      out({ fleet_no: v.fleet_no, cof_due_on: next }, `${v.fleet_no}: COF passed ${done}, next due ${next}.`);
    } else if (sub === 'rego') {
      const due = parseDate(flags.due);
      if (!due) throw new CliError('When is it now due? --due=YYYY-MM-DD off the new licence label.');
      await db.query('update vehicles set rego_due_on = $2 where id = $1', [v.id, due]);
      out({ fleet_no: v.fleet_no, rego_due_on: due }, `${v.fleet_no}: rego due ${due}.`);
    } else if (sub === 'ruc') {
      const toKm = parseQty(flags['to-km'], 'RUC licence distance in km');
      if (!toKm) throw new CliError('Paid to what distance? --to-km= off the new RUC licence.');
      if (num(v.hubodometer_km) && toKm <= num(v.hubodometer_km)) throw new CliError(`That licence ends at ${toKm} km but the hubodometer reads ${v.hubodometer_km} km. Check both numbers.`);
      await db.query('update vehicles set ruc_paid_to_km = $2 where id = $1', [v.id, toKm]);
      out({ fleet_no: v.fleet_no, ruc_paid_to_km: toKm }, `${v.fleet_no}: RUC licence to ${toKm} km (${toKm - num(v.hubodometer_km)} km of headroom).`);
    } else {
      const km = parseQty(args[2] ?? flags.km, 'hubodometer reading');
      if (!km) throw new CliError('What does the hubodometer read? `vehicle hubo T-01 482100`');
      if (num(v.hubodometer_km) && km < num(v.hubodometer_km)) throw new CliError(`${v.fleet_no} already reads ${v.hubodometer_km} km; hubodometers do not run backwards.`);
      await db.query('update vehicles set hubodometer_km = $2 where id = $1', [v.id, km]);
      const left = v.ruc_paid_to_km === null ? null : num(v.ruc_paid_to_km) - km;
      out({ fleet_no: v.fleet_no, hubodometer_km: km, ruc_remaining_km: left },
        `${v.fleet_no}: hubo ${km} km.${left !== null ? ` ${left} km left on the RUC licence${left < 1000 ? ': buy the next block.' : '.'}` : ''}`);
    }
    return;
  }
  const v = await resolve(db, 'vehicle', sub);
  const [f] = await db.query('select * from v_fleet where id = $1', [v.id]);
  const recent = await db.query('select rb.run_no, rb.run_date, rb.driver, rb.stops, rb.load_kg, rb.load_pct from v_run_board rb join runs r on r.id = rb.id where r.vehicle_id = $1 order by rb.run_date desc limit 8', [v.id]);
  out({ vehicle: f, recent_runs: recent }, () =>
    heading(`${f.fleet_no}  ${f.rego || ''}  ${f.description || ''}`) +
    `\n  ${f.vehicle_class}, rated ${f.max_payload_kg} kg.` +
    `\n  COF due ${isoDate(f.cof_due_on) || '-'}${num(f.cof_days) < 0 ? ` (${Math.abs(f.cof_days)}d OVERDUE)` : ''}. Rego due ${isoDate(f.rego_due_on) || '-'}${num(f.rego_days) < 0 ? ` (${Math.abs(f.rego_days)}d OVERDUE)` : ''}.` +
    `\n  ${f.ruc_paid_to_km === null ? 'No RUC (petrol).' : `Hubo ${f.hubodometer_km} km, RUC licence to ${f.ruc_paid_to_km} km: ${f.ruc_remaining_km} km left.`}` +
    (f.note ? `\n  ${f.note}` : '') +
    '\n\nRecent runs\n' + table(recent, [
      { key: 'run_no', label: 'Run' },
      { key: 'run_date', label: 'Date', format: isoDate },
      { key: 'driver', label: 'Driver', width: 18 },
      { key: 'stops', label: 'Stops', align: 'right' },
      { key: 'load_kg', label: 'Kg', align: 'right' },
      { key: 'load_pct', label: 'Of payload', align: 'right', format: (v2) => (v2 === null || v2 === undefined ? '' : `${v2}%`) },
    ]));
}

// ---------------------------------------------------------------------------
// Claims

const CCLA_CAP_CENTS = 200000; // $2,000 per unit: CCLA 2017 Part 5, limited carrier's risk.

async function cmdClaims(db, flags) {
  const rows = await db.query(
    `select cl.*, c.con_no, cu.name as customer, (now()::date - cl.opened_on) as days_open
     from claims cl join consignments c on c.id = cl.consignment_id join customers cu on cu.id = c.customer_id
     ${flags.all ? '' : "where cl.status = 'open'"} order by cl.opened_on`,
  );
  out(rows, () => heading(`Cargo claims (${rows.length}${flags.all ? '' : ' open'})`) + '\n' + table(rows, [
    { key: 'claim_no', label: 'Claim' },
    { key: 'con_no', label: 'Con' },
    { key: 'customer', label: 'Customer', width: 28 },
    { key: 'kind', label: 'Kind' },
    { key: 'claimed_cents', label: 'Claimed', align: 'right', format: (v) => money(v) },
    { key: 'units', label: 'Units', align: 'right' },
    { key: 'status', label: 'Status' },
    { key: 'opened_on', label: 'Opened', format: isoDate },
    { key: 'days_open', label: 'Days', align: 'right', format: (v, r) => (r.status === 'open' ? v : '') },
  ]) + '\n\n  Limited carrier\'s risk caps liability at $2,000 per unit (CCLA 2017 Part 5) unless the contract says otherwise. Decide claims inside the windows: `claim decide`.');
}

async function cmdClaim(db, args, flags) {
  const sub = args[0];
  if (sub === 'open') {
    const c = await resolve(db, 'con', args[1]);
    const kind = str(flags.kind) || c.exception || 'damage';
    if (!['damage', 'loss', 'shortage'].includes(kind)) throw new CliError('--kind is damage, loss or shortage.');
    const claimed = parseMoney(flags.amount);
    if (!claimed) throw new CliError('How much is claimed? --amount= in dollars.');
    const units = flags.units !== undefined ? parseQty(flags.units, 'unit count') : 1;
    const claim_no = await nextRef(db, 'claims', 'claim_no', 'CLM', 28);
    await db.query(
      'insert into claims (claim_no, consignment_id, kind, description, units, claimed_cents) values ($1, $2, $3, $4, $5, $6)',
      [claim_no, c.id, kind, str(flags.desc) || str(flags.note) || null, units, claimed],
    );
    const cap = units * CCLA_CAP_CENTS;
    out({ claim_no, con_no: c.con_no, kind, claimed_cents: claimed, units, cap_cents: cap },
      `${claim_no} opened: ${kind} on ${c.con_no}, ${money(claimed)} claimed over ${units} unit(s).\n` +
      `  Limited carrier's risk caps liability at ${money(cap)} (${units} x $2,000, CCLA 2017 Part 5) unless your contract says otherwise.` +
      (claimed > cap ? ` The claim EXCEEDS the cap: worth saying early.` : '') +
      `\n  Decide it inside the windows: \`claim decide ${claim_no} --accept|--decline --note=\`.`);
    return;
  }
  if (sub === 'decide') {
    const cl = await resolve(db, 'claim', args[1]);
    if (cl.status !== 'open') throw new CliError(`${cl.claim_no} is already ${cl.status}.`);
    if (!flags.accept && !flags.decline) throw new CliError('Which way? --accept or --decline, with --note= for the record.');
    const status = flags.accept ? 'accepted' : 'declined';
    await db.query('update claims set status = $2, decided_on = $3, outcome = $4 where id = $1', [cl.id, status, today(), str(flags.note) || null]);
    out({ claim_no: cl.claim_no, status }, `${cl.claim_no} ${status}.${status === 'accepted' ? ` Settle it: \`claim settle ${cl.claim_no} --amount=\` when paid.` : ''}\n  The letter to the customer is drafted (/draft-claim-response), never sent from here.`);
    return;
  }
  if (sub === 'settle') {
    const cl = await resolve(db, 'claim', args[1]);
    if (cl.status !== 'accepted') throw new CliError(`${cl.claim_no} is ${cl.status}; settle follows accept.`);
    const amount = parseMoney(flags.amount);
    if (!amount) throw new CliError('Settled for how much? --amount=');
    await db.query("update claims set status = 'settled', settled_cents = $2 where id = $1", [cl.id, amount]);
    out({ claim_no: cl.claim_no, settled_cents: amount }, `${cl.claim_no} settled for ${money(amount)}.`);
    return;
  }
  const cl = await resolve(db, 'claim', sub);
  out(cl, () => heading(`${cl.claim_no}  ${cl.kind} on ${cl.con_no} (${cl.status})`) +
    `\n  ${cl.customer_name}. Claimed ${money(cl.claimed_cents)} over ${cl.units} unit(s); cap ${money(cl.units * CCLA_CAP_CENTS)}.` +
    `\n  Opened ${isoDate(cl.opened_on)}${cl.decided_on ? `, decided ${isoDate(cl.decided_on)}` : ''}${cl.settled_cents ? `, settled ${money(cl.settled_cents)}` : ''}.` +
    (cl.description ? `\n  ${cl.description}` : '') + (cl.outcome ? `\n  Outcome: ${cl.outcome}` : ''));
}

// ---------------------------------------------------------------------------
// Customers

async function cmdCustomers(db) {
  const rows = await db.query("select * from v_customer_position where status = 'active' order by exposure_cents desc");
  out(rows, () => heading(`Customers (${rows.length})`) + '\n' + table(rows, [
    { key: 'customer', label: 'Customer', width: 32, format: (v, r) => v + (r.on_stop ? ' [STOP]' : '') },
    { key: 'open_cons', label: 'Open', align: 'right' },
    { key: 'owing_cents', label: 'Owing', align: 'right', format: (v) => (num(v) > 0 ? money(v) : '') },
    { key: 'unbilled_cents', label: 'Unbilled', align: 'right', format: (v) => (num(v) > 0 ? money(v) : '') },
    { key: 'exposure_cents', label: 'Exposure', align: 'right', format: (v) => (num(v) > 0 ? money(v) : '') },
    { key: 'credit_limit_cents', label: 'Limit', align: 'right', format: (v, r) => (v === null ? '' : money(v) + (num(r.exposure_cents) > num(v) ? ' OVER' : '')) },
  ]));
}

async function cmdCustomer(db, args) {
  const cu = await resolve(db, 'customer', args[0]);
  const [pos] = await db.query('select * from v_customer_position where customer_id = $1', [cu.id]);
  const cons = await db.query('select * from v_board where customer_id = $1 order by booked_on desc limit 15', [cu.id]);
  const invoices = await db.query("select number, issued_on, due_on, status, total_cents from invoices where customer_id = $1 order by issued_on desc limit 8", [cu.id]);
  const claims = await db.query('select cl.claim_no, cl.kind, cl.claimed_cents, cl.status, c.con_no from claims cl join consignments c on c.id = cl.consignment_id where c.customer_id = $1 order by cl.opened_on desc', [cu.id]);
  const [difot] = await db.query('select * from v_difot where customer_id = $1', [cu.id]);
  const notes = await db.query('select body, created_at from notes where customer_id = $1 order by created_at desc limit 6', [cu.id]);
  const tasks = await db.query("select title, due_on, status from tasks where customer_id = $1 and status = 'open' order by due_on", [cu.id]);
  out({ customer: cu, position: pos, difot, consignments: cons, invoices, claims, notes, tasks }, () => {
    const lines = [heading(`${cu.name}${cu.on_stop ? '  [ON STOP]' : ''}`)];
    lines.push(`  ${cu.contact_name || '-'}  ${cu.email || ''}  ${cu.phone || ''}  ${cu.city || ''}`);
    lines.push(`  Terms ${cu.terms_days} days. Fuel levy ${cu.fuel_levy_pct}%. Owing ${money(pos.owing_cents)} + unbilled ${money(pos.unbilled_cents)} = exposure ${money(pos.exposure_cents)}${cu.credit_limit_cents !== null ? ` against a ${money(cu.credit_limit_cents)} limit${num(pos.exposure_cents) > num(cu.credit_limit_cents) ? ': OVER' : ''}` : ''}.`);
    if (difot) lines.push(`  DIFOT last 28 days: ${difot.difot_pct}% (${difot.difot} of ${difot.delivered} in full and on time).`);
    if (cu.note) lines.push(`  ${cu.note}`);
    lines.push('\nRecent consignments\n' + table(cons, [
      { key: 'con_no', label: 'Con' },
      { key: 'origin_zone', label: 'From' },
      { key: 'dest_zone', label: 'To' },
      { key: 'status', label: 'Status' },
      { key: 'required_by', label: 'Required', format: isoDate },
      { key: 'charge_cents', label: 'Charge', align: 'right', format: (v, r) => (r.rate_desc ? money(v) : 'NO RATE') },
      { key: 'exception', label: 'Exception' },
    ]));
    lines.push('\nInvoices\n' + table(invoices, [
      { key: 'number', label: 'Invoice' },
      { key: 'issued_on', label: 'Issued', format: isoDate },
      { key: 'due_on', label: 'Due', format: isoDate },
      { key: 'status', label: 'Status' },
      { key: 'total_cents', label: 'Total', align: 'right', format: (v) => money(v) },
    ]));
    if (claims.length) lines.push('\nClaims\n' + table(claims, [
      { key: 'claim_no', label: 'Claim' },
      { key: 'con_no', label: 'Con' },
      { key: 'kind', label: 'Kind' },
      { key: 'claimed_cents', label: 'Claimed', align: 'right', format: (v) => money(v) },
      { key: 'status', label: 'Status' },
    ]));
    for (const t of tasks) lines.push(`  Task: ${t.title} (due ${isoDate(t.due_on) || 'open'})`);
    for (const n of notes) lines.push(`  Note ${isoDate(n.created_at)}: ${n.body}`);
    return lines.join('\n');
  });
}

async function cmdAdd(db, args, flags) {
  const kind = args[0];
  if (kind === 'customer') {
    const name = args.slice(1).join(' ');
    if (!name) throw new CliError('add customer <name> [--code= --contact= --email= --phone= --city= --terms= --limit= --levy=]');
    await db.query(
      `insert into customers (name, code, contact_name, email, phone, city, terms_days, credit_limit_cents, fuel_levy_pct)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [name, str(flags.code) || null, str(flags.contact) || null, str(flags.email) || null, str(flags.phone) || null,
        str(flags.city) || null, flags.terms !== undefined ? parseQty(flags.terms, 'terms in days') : 20,
        flags.limit !== undefined ? parseMoney(flags.limit) : null,
        flags.levy !== undefined ? parseQty(flags.levy, 'levy percent') : 0],
    );
    out({ name }, `Customer added: ${name}.`);
    return;
  }
  if (kind === 'driver') {
    const name = args.slice(1).join(' ');
    if (!name) throw new CliError('add driver <name> [--code= --phone= --licence= --dg --base=]');
    await db.query(
      'insert into drivers (full_name, code, phone, licence_class, dg_endorsed, base) values ($1,$2,$3,$4,$5,$6)',
      [name, str(flags.code) || null, str(flags.phone) || null, str(flags.licence) || 'Class 5', Boolean(flags.dg), str(flags.base) || null],
    );
    out({ name, dg_endorsed: Boolean(flags.dg) }, `Driver added: ${name}${flags.dg ? ' (D endorsed)' : ''}.`);
    return;
  }
  if (kind === 'vehicle') {
    const fleet = args[1];
    if (!fleet) throw new CliError('add vehicle <fleet-no> [--rego= --desc= --class= --payload= --cof-due= --rego-due= --ruc-to= --hubo=]');
    await db.query(
      `insert into vehicles (fleet_no, rego, description, vehicle_class, max_payload_kg, cof_due_on, rego_due_on, ruc_paid_to_km, hubodometer_km)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [fleet, str(flags.rego) || null, str(flags.desc) || null, str(flags.class) || 'truck',
        parseQty(flags.payload, 'payload in kg'), parseDate(flags['cof-due']), parseDate(flags['rego-due']),
        flags['ruc-to'] !== undefined ? parseQty(flags['ruc-to'], 'RUC distance') : null,
        flags.hubo !== undefined ? parseQty(flags.hubo, 'hubodometer km') : null],
    );
    out({ fleet_no: fleet }, `Vehicle added: ${fleet}.`);
    return;
  }
  throw new CliError('add customer | add driver | add vehicle');
}

async function cmdStop(db, args, on) {
  const cu = await resolve(db, 'customer', args[0]);
  await db.query('update customers set on_stop = $2 where id = $1', [cu.id, on]);
  out({ customer: cu.name, on_stop: on }, `${cu.name} ${on ? 'is ON STOP: no new bookings until released.' : 'released from stop.'}`);
}

// ---------------------------------------------------------------------------
// Notes, tasks

async function cmdLog(db, args, flags) {
  const body = args.join(' ') || str(flags.note);
  if (!body) throw new CliError('Log what? `log "Karen promised payment Friday" --customer="Manawatu Fresh"`');
  const cu = flags.customer ? await resolve(db, 'customer', flags.customer) : null;
  const con = flags.con ? await resolve(db, 'con', flags.con) : null;
  if (!cu && !con) throw new CliError('Against whom? --customer= or --con=.');
  await db.query('insert into notes (customer_id, consignment_id, body) values ($1, $2, $3)', [cu?.id || con?.customer_id || null, con?.id || null, body]);
  out({ customer: cu?.name, con: con?.con_no, body }, `Noted against ${con ? con.con_no : cu.name}.`);
}

async function cmdTasks(db, flags) {
  const rows = await db.query(
    `select t.*, cu.name as customer, case when t.due_on < now()::date and t.status = 'open' then (now()::date - t.due_on) end as days_overdue
     from tasks t left join customers cu on cu.id = t.customer_id ${flags.all ? '' : "where t.status = 'open'"} order by t.due_on nulls last`,
  );
  out(rows, () => heading(`Tasks (${rows.length}${flags.all ? '' : ' open'})`) + '\n' + table(rows, [
    { key: 'id', label: 'Id', format: short },
    { key: 'title', label: 'Task', width: 50 },
    { key: 'customer', label: 'Customer', width: 26 },
    { key: 'due_on', label: 'Due', format: isoDate },
    { key: 'days_overdue', label: 'Overdue', align: 'right', format: (v) => (num(v) > 0 ? `${v}d` : '') },
    { key: 'status', label: 'Status' },
  ]));
}

async function cmdTask(db, args, flags) {
  const sub = args[0];
  if (sub === 'add') {
    const title = args.slice(1).join(' ');
    if (!title) throw new CliError('task add <title> [--customer=] [--due=]');
    const cu = flags.customer ? await resolve(db, 'customer', flags.customer) : null;
    await db.query('insert into tasks (title, customer_id, due_on) values ($1, $2, $3)', [title, cu?.id || null, parseDate(flags.due)]);
    out({ title }, `Task added: ${title}.`);
    return;
  }
  if (sub === 'done') {
    const t = await resolve(db, 'task', args.slice(1).join(' '));
    await db.query("update tasks set status = 'done', done_on = $2 where id = $1", [t.id, today()]);
    out({ title: t.title }, `Done: ${t.title}.`);
    return;
  }
  throw new CliError('task add <title> | task done <title or id>');
}

// ---------------------------------------------------------------------------
// Compliance, stats

async function cmdCompliance(db, only) {
  const results = [];
  for (const rule of RULES) {
    if (only && rule.key !== only) continue;
    const breaches = await db.query(rule.sql);
    results.push({ key: rule.key, title: rule.title, source: rule.source, fix: rule.fix, breaches });
  }
  if (!results.length) throw new CliError(`No rule "${only}". Rules: ${RULES.map((r) => r.key).join(', ')}.`);
  out(results, () => {
    const lines = [heading('Compliance: the rule book against the records')];
    for (const r of results) {
      lines.push(`\n${r.breaches.length ? 'BREACH' : '  ok  '}  ${r.key}: ${r.title}`);
      if (r.breaches.length) {
        lines.push(table(r.breaches, Object.keys(r.breaches[0]).map((k) => ({ key: k, label: k.replace(/_/g, ' '), width: 30 }))));
        lines.push(`  Fix: ${r.fix}`);
      }
    }
    lines.push('\n  Sources and the full rule book: docs/compliance.md. None of this is legal advice.');
    return lines.join('\n');
  });
}

async function cmdStats(db) {
  const [s] = await db.query(`
    select
      (select count(*) from consignments where status not in ('delivered', 'cancelled')) as open_cons,
      (select count(*) from consignments where status = 'delivered' and delivered_at >= now() - interval '7 days') as delivered_7d,
      (select count(*) from v_pod_gap) as pod_gaps,
      (select coalesce(sum(charge_cents), 0) from v_unbilled) as unbilled_cents,
      (select coalesce(sum(total_cents), 0) from invoices where status = 'sent') as owing_cents,
      (select count(*) from v_debtors where days_overdue > 0) as overdue_invoices,
      (select count(*) from claims where status = 'open') as open_claims,
      (select count(*) from runs where run_date = now()::date) as runs_today,
      (select count(*) from v_attention) as attention,
      (select round(avg(difot_pct))::int from v_difot) as difot_pct
  `);
  out(s, () => heading('The week in one line') +
    `\n  ${s.open_cons} open consignments, ${s.delivered_7d} delivered this week, ${s.runs_today} runs today.` +
    `\n  ${s.pod_gaps} PODs missing. ${money(s.unbilled_cents)} unbilled. ${money(s.owing_cents)} owing (${s.overdue_invoices} invoices overdue).` +
    `\n  ${s.open_claims} open claims. DIFOT ${s.difot_pct ?? '-'}% across customers. ${s.attention} items on the attention list.`);
}

// ---------------------------------------------------------------------------
// Import / export

async function upsert(db, tableName, extRef, cols, vals) {
  const existing = await db.query(`select id from ${tableName} where external_ref = $1`, [extRef]);
  if (existing.length) {
    const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    await db.query(`update ${tableName} set ${sets} where id = $1`, [existing[0].id, ...vals]);
    return { id: existing[0].id, updated: true };
  }
  const params = cols.map((_, i) => `$${i + 2}`).join(', ');
  const [row] = await db.query(
    `insert into ${tableName} (external_ref, ${cols.join(', ')}) values ($1, ${params}) returning id`,
    [extRef, ...vals],
  );
  return { id: row.id, updated: false };
}

async function cmdImport(db, args, flags) {
  const source = args[0] || 'transvirtual';
  const dry = Boolean(flags['dry-run']);
  const readFile = (flag, what) => {
    const p = str(flags[flag]);
    if (!p) return null;
    if (!existsSync(p)) throw new CliError(`No ${what} file at ${p}.`);
    return parseCsv(readFileSync(p, 'utf8'));
  };
  const customersCsv = readFile('customers', 'customers');
  const consCsv = readFile('consignments', 'consignments');
  const ratesCsv = readFile('rates', 'rates');
  if (!customersCsv && !consCsv && !ratesCsv) {
    throw new CliError(`Nothing to import. Give me --customers=, --consignments= and/or --rates= CSV files exported from ${source}. See docs/replace-transvirtual.md.`);
  }
  const counts = { customers: 0, customers_updated: 0, consignments: 0, consignments_updated: 0, rates: 0, rates_updated: 0, skipped: [] };
  // On a dry run nothing is written, so customers arriving in this same batch
  // still count as known when their consignments and rates reference them.
  const batchCustomers = new Set(
    (customersCsv || [])
      .map((row) => (pick(row, 'Customer', 'Customer Name', 'Account Name', 'Name', 'Company') || '').toLowerCase())
      .filter(Boolean),
  );
  const knownCustomer = async (name) => {
    const found = await db.query('select id from customers where lower(name) = lower($1)', [name]);
    if (found.length) return found[0].id;
    if (dry && batchCustomers.has(name.toLowerCase())) return 'dry-run-pending';
    return null;
  };

  if (customersCsv) {
    for (const row of customersCsv) {
      const name = pick(row, 'Customer', 'Customer Name', 'Account Name', 'Name', 'Company');
      if (!name) continue;
      const ext = `${source}:cust:${(pick(row, 'Customer Code', 'Account Code', 'Code') || name).toLowerCase()}`;
      const vals = [name, pick(row, 'Customer Code', 'Account Code', 'Code') || null,
        pick(row, 'Contact', 'Contact Name') || null, pick(row, 'Email', 'Email Address') || null,
        pick(row, 'Phone', 'Phone Number') || null, pick(row, 'City', 'Suburb', 'Town') || null,
        Number(pick(row, 'Payment Terms', 'Terms', 'Terms Days') || 20)];
      const existing = await db.query('select id from customers where external_ref = $1 or lower(name) = lower($2)', [ext, name]);
      if (dry) { existing.length ? counts.customers_updated++ : counts.customers++; continue; }
      if (existing.length) {
        await db.query('update customers set name=$2, code=$3, contact_name=$4, email=$5, phone=$6, city=$7, terms_days=$8, external_ref=coalesce(external_ref, $9) where id=$1', [existing[0].id, ...vals, ext]);
        counts.customers_updated++;
      } else {
        await db.query('insert into customers (name, code, contact_name, email, phone, city, terms_days, external_ref) values ($1,$2,$3,$4,$5,$6,$7,$8)', [...vals, ext]);
        counts.customers++;
      }
    }
  }

  if (ratesCsv) {
    for (const row of ratesCsv) {
      const origin = pick(row, 'From Zone', 'Origin', 'From', 'Origin Zone');
      const dest = pick(row, 'To Zone', 'Destination', 'To', 'Dest Zone');
      const rate = pick(row, 'Rate', 'Charge Rate', 'Price');
      if (!origin || !dest || !rate) continue;
      const service = (pick(row, 'Service', 'Service Level') || 'general').toLowerCase();
      const basisRaw = (pick(row, 'Basis', 'Charge Basis', 'Unit', 'Charge Unit') || 'per kg').toLowerCase();
      const basis = basisRaw.includes('pallet') ? 'per_pallet' : basisRaw.includes('item') || basisRaw.includes('unit') ? 'per_item' : 'per_kg';
      const rate_cents = basis === 'per_kg' ? Math.round(Number(rate) * (Number(rate) < 5 ? 100 : 1)) : Math.round(Number(rate) * 100);
      const min = Math.round(Number(pick(row, 'Min', 'Minimum', 'Min Charge') || 0) * 100);
      const custName = pick(row, 'Customer', 'Customer Name', 'Account');
      let customerId = null;
      if (custName) {
        customerId = await knownCustomer(custName);
        if (!customerId) { counts.skipped.push(`rate ${origin}-${dest}: unknown customer "${custName}" (import customers first)`); continue; }
      }
      const ext = `${source}:rate:${(custName || 'std').toLowerCase()}:${origin.toLowerCase()}:${dest.toLowerCase()}:${service}`;
      const existing = await db.query('select id from rate_cards where external_ref = $1', [ext]);
      if (dry) { existing.length ? counts.rates_updated++ : counts.rates++; continue; }
      if (existing.length) {
        await db.query('update rate_cards set rate_cents=$2, min_charge_cents=$3, basis=$4 where id=$1', [existing[0].id, rate_cents, min, basis]);
        counts.rates_updated++;
      } else {
        await db.query('insert into rate_cards (customer_id, origin_zone, dest_zone, service, basis, rate_cents, min_charge_cents, external_ref) values ($1,$2,$3,$4,$5,$6,$7,$8)',
          [customerId, origin.toUpperCase(), dest.toUpperCase(), service, basis, rate_cents, min, ext]);
        counts.rates++;
      }
    }
  }

  if (consCsv) {
    for (const row of consCsv) {
      const conNo = pick(row, 'Connote', 'Connote Number', 'Connote No', 'Con Note', 'Consignment Number', 'Consignment No');
      const custName = pick(row, 'Customer', 'Customer Name', 'Account', 'Sender');
      if (!conNo || !custName) continue;
      const customerId = await knownCustomer(custName);
      if (!customerId) { counts.skipped.push(`${conNo}: unknown customer "${custName}" (import customers first)`); continue; }
      const delivered = pick(row, 'Delivered Date', 'Delivered', 'POD Date', 'Delivery Date');
      const podName = pick(row, 'POD Name', 'Signed By', 'POD Signature Name', 'Receiver Signature');
      const charge = pick(row, 'Freight Charge', 'Charge', 'Total Charge', 'Total (ex GST)', 'Price');
      const ext = `${source}:con:${conNo.toLowerCase()}`;
      const cols = ['con_no', 'customer_id', 'customer_ref', 'receiver_name', 'dest_address', 'origin_zone', 'dest_zone', 'service',
        'items', 'pallets', 'weight_kg', 'status', 'booked_on', 'required_by', 'delivered_at', 'pod_name', 'pod_at', 'charge_cents', 'rate_desc'];
      const deliveredIso = delivered ? parseDate(delivered) : null;
      const vals = [conNo, customerId, pick(row, 'Reference', 'Customer Reference', 'Order No') || null,
        pick(row, 'Receiver', 'Receiver Name', 'Deliver To') || null,
        pick(row, 'Receiver Address', 'Delivery Address', 'Address') || null,
        (pick(row, 'From Zone', 'Origin Zone', 'Sender Suburb', 'From') || 'UNK').toUpperCase(),
        (pick(row, 'To Zone', 'Dest Zone', 'Receiver Suburb', 'To') || 'UNK').toUpperCase(),
        (pick(row, 'Service', 'Service Level') || 'general').toLowerCase(),
        Number(pick(row, 'Items', 'Item Count', 'Qty') || 1), Number(pick(row, 'Pallets', 'Pallet Count') || 0),
        Number(pick(row, 'Weight', 'Total Weight', 'Weight (kg)', 'Weight Kg') || 0),
        deliveredIso ? 'delivered' : 'booked',
        parseDate(pick(row, 'Booked Date', 'Booked', 'Created Date', 'Consignment Date') || null) || today(),
        parseDate(pick(row, 'Required Date', 'Required By', 'Due Date') || null),
        deliveredIso, podName || null, podName && deliveredIso ? deliveredIso : null,
        charge ? Math.round(Number(String(charge).replace(/[^0-9.-]/g, '')) * 100) : 0,
        charge ? `Imported from ${source}` : null];
      const existing = await db.query('select id from consignments where external_ref = $1', [ext]);
      if (dry) { existing.length ? counts.consignments_updated++ : counts.consignments++; continue; }
      if (existing.length) {
        const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
        await db.query(`update consignments set ${sets} where id = $1`, [existing[0].id, ...vals]);
        counts.consignments_updated++;
      } else {
        await db.query(
          `insert into consignments (external_ref, ${cols.join(', ')}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`,
          [ext, ...vals],
        );
        counts.consignments++;
      }
    }
  }

  out(counts, () => {
    const lines = [heading(dry ? 'Import dry run (nothing written)' : 'Imported')];
    lines.push(`  Customers: ${counts.customers} new, ${counts.customers_updated} updated.`);
    lines.push(`  Rates: ${counts.rates} new, ${counts.rates_updated} updated.`);
    lines.push(`  Consignments: ${counts.consignments} new, ${counts.consignments_updated} updated.`);
    for (const s of counts.skipped) lines.push(`  skipped: ${s}`);
    if (!dry) lines.push('  Delivered history landed delivered with its PODs; open freight landed booked. Runs, work time and claims start from cutover day: docs/replace-transvirtual.md says why.');
    return lines.join('\n');
  });
}

async function cmdExport(db, flags) {
  const tables = ['customers', 'drivers', 'vehicles', 'rate_cards', 'runs', 'consignments', 'invoices', 'invoice_lines', 'claims', 'notes', 'tasks'];
  const dump = { exported_at: new Date().toISOString() };
  const counts = {};
  for (const t of tables) {
    dump[t] = await db.query(`select * from ${t}`);
    counts[t] = dump[t].length;
  }
  const file = str(flags.out) || path.join(REPO_ROOT, 'exports', `freight-${today()}.json`);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(dump, null, 2));
  out({ file, counts }, `Exported ${Object.values(counts).reduce((a, b) => a + b, 0)} rows to ${file}.`);
}

// ---------------------------------------------------------------------------
// Help

const HELP = `freight-ops-for-claude-code: the CLI. Any command takes --json.

The freight
  board [--all] [--customer=]         every open consignment; --all includes history
  con <ref>                           one consignment's whole story
  book <customer> --from-zone= --to-zone= [--weight= --pallets= --items= --service=
       --receiver= --dest-address= --required= --dg --dg-class= --ref= --charge=]
  assign <con> <run> [--drop=]        DG endorsement and payload gates apply
  pickup <con> [--at=]                deliver <con> --pod="Name" [--at= --exception= --note= --no-pod]
  pod <con> --name= [--at=]           backfill the signature that turned up
  pods                                delivered with no signed POD: billing blocked
  hold <con> --reason=   release <con>   cancel <con> --reason=

The runs
  runs [--date=|--all]                run <ref>          the manifest
  run create [--date= --driver= --vehicle= --name=]
  run depart <ref> [--at=]            run return <ref> [--at= --break=]
  run break <ref> <minutes>           record the rest break that was taken
  hours [--days=]                     the work-time record, breaches flagged
  drivers    driver <name>

The money
  rates [customer]    rate add <from> <to> --rate= [--basis= --min= --service= --customer=]
  rate check                          consignments moving with no rate
  rerate <con>                        re-price off the cards after fixing them
  bill [customer] [--dry-run]         draft invoices for delivered POD-backed freight
  invoices [--all]    invoice <no>    invoice sent <no>    invoice paid <no>
  debtors                             difot [customer]

The fleet
  fleet    vehicle <ref>
  vehicle cof <ref> [--done= --next=]    vehicle rego <ref> --due=
  vehicle ruc <ref> --to-km=             vehicle hubo <ref> <km>

Claims
  claims [--all]    claim <no>
  claim open <con> --kind=damage|loss|shortage --amount= [--units= --desc=]
  claim decide <no> --accept|--decline [--note=]    claim settle <no> --amount=

The accounts
  customers    customer <name>    stop <name>    unstop <name>
  add customer <name> ...    add driver <name> ...    add vehicle <fleet> ...

The office
  attention                           everything that wants a decision, worst first
  compliance [rule]                   the rule book against the records
  stats    log <text> --customer=|--con=    tasks    task add|done
  import transvirtual --customers= --consignments= --rates= [--dry-run]
  export [--out=]
`;

// ---------------------------------------------------------------------------
// Dispatch

async function main() {
  const { args: argv, flags } = parseArgv(process.argv.slice(2));
  JSON_MODE = Boolean(flags.json);
  const [cmd, ...args] = argv;
  if (!cmd || cmd === 'help' || flags.help) {
    console.log(HELP);
    return;
  }
  const db = await getDb();
  try {
    switch (cmd) {
      case 'attention': await cmdAttention(db); break;
      case 'board': case 'consignments': await cmdBoard(db, flags); break;
      case 'con': await cmdCon(db, args[0]); break;
      case 'book': await cmdBook(db, args, flags); break;
      case 'assign': await cmdAssign(db, args, flags); break;
      case 'pickup': await cmdPickup(db, args, flags); break;
      case 'deliver': await cmdDeliver(db, args, flags); break;
      case 'pod': await cmdPod(db, args, flags); break;
      case 'pods': await cmdPods(db); break;
      case 'hold': await cmdHold(db, args, flags); break;
      case 'release': await cmdRelease(db, args); break;
      case 'cancel': await cmdCancel(db, args, flags); break;
      case 'runs': await cmdRuns(db, flags); break;
      case 'run': await cmdRun(db, args, flags); break;
      case 'hours': await cmdHours(db, flags); break;
      case 'drivers': await cmdDrivers(db); break;
      case 'driver': await cmdDriver(db, args); break;
      case 'fleet': await cmdFleet(db); break;
      case 'vehicle': await cmdVehicle(db, args, flags); break;
      case 'rates': await cmdRates(db, args); break;
      case 'rate':
        if (args[0] === 'add') await cmdRateAdd(db, args.slice(1), flags);
        else if (args[0] === 'check') await cmdRateCheck(db);
        else throw new CliError('rate add <from> <to> --rate= | rate check');
        break;
      case 'rerate': await cmdRerate(db, args); break;
      case 'bill': await cmdBill(db, args, flags); break;
      case 'invoices': await cmdInvoices(db, flags); break;
      case 'invoice': await cmdInvoice(db, args, flags); break;
      case 'debtors': await cmdDebtors(db); break;
      case 'difot': await cmdDifot(db, args); break;
      case 'claims': await cmdClaims(db, flags); break;
      case 'claim': await cmdClaim(db, args, flags); break;
      case 'customers': await cmdCustomers(db); break;
      case 'customer': await cmdCustomer(db, args); break;
      case 'add': await cmdAdd(db, args, flags); break;
      case 'stop': await cmdStop(db, args, true); break;
      case 'unstop': await cmdStop(db, args, false); break;
      case 'log': await cmdLog(db, args, flags); break;
      case 'tasks': await cmdTasks(db, flags); break;
      case 'task': await cmdTask(db, args, flags); break;
      case 'compliance': await cmdCompliance(db, args[0]); break;
      case 'stats': await cmdStats(db); break;
      case 'import': await cmdImport(db, args, flags); break;
      case 'export': await cmdExport(db, flags); break;
      default:
        throw new CliError(`Unknown command "${cmd}". Run \`help\` for the list.`);
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  if (err instanceof CliError) {
    console.error(err.message);
    process.exit(err.code);
  }
  console.error(err);
  process.exit(1);
});
