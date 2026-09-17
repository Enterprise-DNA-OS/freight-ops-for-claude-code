-- freight-ops-for-claude-code: core schema.
-- A general freight carrier: the account customers and their rate cards, the
-- drivers and their endorsements, the trucks with their COF, rego and RUC
-- clocks, the consignments from booking to signed POD, the runs the freight
-- moves on, the invoice run that bills delivered POD-backed freight, and the
-- cargo claims handled inside the Act's windows.
--
-- Runs unchanged on PGlite (embedded) and on Postgres / Supabase.
--
-- Money is in cents. Weight is in kilograms. Charges are rated onto the
-- consignment at booking, off the rate card that matched, and the match is
-- recorded (rate_desc), so a rate card change never reprices booked freight.
-- The board, billing, DIFOT and the attention list all read the consignments
-- table through the views below, so they can never disagree with each other.

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- Customers ------------------------------------------------------------------
-- The account customers freight is booked for. fuel_levy_pct is the surcharge
-- the invoice run adds as its own line. on_stop is the credit hold: the CLI
-- refuses new bookings for a stopped account.

create table if not exists customers (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  code               text,
  contact_name       text,
  email              text,
  phone              text,
  city               text,
  terms_days         integer not null default 20,
  credit_limit_cents bigint,
  fuel_levy_pct      numeric not null default 0,
  on_stop            boolean not null default false,
  status             text not null default 'active',  -- active | former
  note               text,
  external_ref       text unique,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists customers_name_lower_idx on customers (lower(name));

-- Drivers ------------------------------------------------------------------
-- dg_endorsed is the D endorsement on the licence (Land Transport Rule:
-- Dangerous Goods 2005): dangerous goods do not ride with a driver who does
-- not hold it, and `assign` refuses.

create table if not exists drivers (
  id           uuid primary key default gen_random_uuid(),
  full_name    text not null,
  code         text,
  phone        text,
  licence_class text not null default 'Class 5',
  dg_endorsed  boolean not null default false,
  base         text,
  active       boolean not null default true,
  note         text,
  external_ref text unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists drivers_name_lower_idx on drivers (lower(full_name));

-- Vehicles ------------------------------------------------------------------
-- Each truck carries its own compliance clocks: COF (six-monthly on heavy
-- vehicles), registration, and the RUC licence distance against the
-- hubodometer (Road User Charges Act 2012: driving past the licence distance
-- is an offence). max_payload_kg is the rated payload `assign` protects.

create table if not exists vehicles (
  id             uuid primary key default gen_random_uuid(),
  fleet_no       text not null,
  rego           text,
  description    text,
  vehicle_class  text not null default 'truck',  -- truck | truck-trailer | van
  max_payload_kg numeric not null default 0,
  cof_due_on     date,
  rego_due_on    date,
  ruc_paid_to_km bigint,                          -- null for petrol vans (no RUC)
  hubodometer_km bigint,
  active         boolean not null default true,
  note           text,
  external_ref   text unique,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists vehicles_fleet_lower_idx on vehicles (lower(fleet_no));

-- Rate cards ------------------------------------------------------------------
-- customer_id null is the standard tariff; a customer's own row wins over it.
-- Booking finds the best match on (customer, origin zone, dest zone, service)
-- and stamps the charge and the match description onto the consignment.

create table if not exists rate_cards (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid references customers (id),
  origin_zone      text not null,
  dest_zone        text not null,
  service          text not null default 'general',  -- general | overnight | sameday
  basis            text not null default 'per_kg',   -- per_kg | per_pallet | per_item
  rate_cents       bigint not null,
  min_charge_cents bigint not null default 0,
  effective_on     date not null default now()::date,
  note             text,
  external_ref     text unique,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists rate_cards_lane_idx
  on rate_cards (coalesce(customer_id::text, 'standard'), lower(origin_zone), lower(dest_zone), lower(service));

-- Runs ------------------------------------------------------------------
-- One driver, one vehicle, one date. depart/return bracket the work time and
-- break_minutes is the rest actually taken: together they are the work-time
-- record the logbook rules read (Land Transport Rule: Work Time and Logbooks
-- 2007).

create table if not exists runs (
  id            uuid primary key default gen_random_uuid(),
  run_no        text not null,
  name          text,
  run_date      date not null default now()::date,
  driver_id     uuid references drivers (id),
  vehicle_id    uuid references vehicles (id),
  status        text not null default 'planned',  -- planned | out | done
  depart_at     timestamptz,
  return_at     timestamptz,
  break_minutes integer not null default 0,
  note          text,
  external_ref  text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists runs_no_lower_idx on runs (lower(run_no));

-- Consignments ------------------------------------------------------------------
-- The unit of the whole business. Rated at booking; assigned to a run; picked
-- up; delivered against a POD name and time. An exception at the door
-- (damage, shortage, refused) is recorded on the row and feeds DIFOT and the
-- claims process. invoice_id set means billed.

create table if not exists consignments (
  id              uuid primary key default gen_random_uuid(),
  con_no          text not null,
  customer_id     uuid not null references customers (id),
  customer_ref    text,
  sender_name     text,
  origin_address  text,
  origin_zone     text not null,
  receiver_name   text,
  dest_address    text,
  dest_zone       text not null,
  service         text not null default 'general',
  items           integer not null default 1,
  pallets         numeric not null default 0,
  weight_kg       numeric not null default 0,
  cubic_m         numeric,
  dangerous_goods boolean not null default false,
  dg_class        text,
  instructions    text,
  status          text not null default 'booked',  -- booked | assigned | picked-up | delivered | on-hold | cancelled
  booked_on       date not null default now()::date,
  required_by     date,
  run_id          uuid references runs (id),
  drop_order      integer,
  picked_up_at    timestamptz,
  delivered_at    timestamptz,
  pod_name        text,
  pod_at          timestamptz,
  exception       text,                             -- null | damage | shortage | refused
  exception_note  text,
  charge_cents    bigint not null default 0,
  rate_desc       text,                             -- how it was rated; null means no rate matched
  invoice_id      uuid,
  note            text,
  external_ref    text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists consignments_no_lower_idx on consignments (lower(con_no));
create index if not exists consignments_run_idx on consignments (run_id);
create index if not exists consignments_customer_idx on consignments (customer_id);

-- Invoices ------------------------------------------------------------------
-- Drafted by the billing run from delivered POD-backed consignments, plus the
-- fuel levy line. Sent and reconciled by a person in the accounting system;
-- nothing here sends anything.

create table if not exists invoices (
  id           uuid primary key default gen_random_uuid(),
  number       text not null,
  customer_id  uuid not null references customers (id),
  issued_on    date not null default now()::date,
  due_on       date,
  status       text not null default 'draft',  -- draft | sent | paid
  total_cents  bigint not null default 0,
  note         text,
  external_ref text unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists invoices_number_lower_idx on invoices (lower(number));

create table if not exists invoice_lines (
  id             uuid primary key default gen_random_uuid(),
  invoice_id     uuid not null references invoices (id),
  consignment_id uuid references consignments (id),
  description    text not null,
  amount_cents   bigint not null,
  created_at     timestamptz not null default now()
);
create index if not exists invoice_lines_invoice_idx on invoice_lines (invoice_id);

-- Claims ------------------------------------------------------------------
-- Cargo claims under the Contract and Commercial Law Act 2017 Part 5
-- (carriage of goods). Default carriage is at limited carrier's risk:
-- liability capped at $2,000 per unit of goods. units is the unit count the
-- cap multiplies; the CLI states the cap when the claim opens.

create table if not exists claims (
  id             uuid primary key default gen_random_uuid(),
  claim_no       text not null,
  consignment_id uuid not null references consignments (id),
  kind           text not null default 'damage',  -- damage | loss | shortage
  description    text,
  units          integer not null default 1,
  claimed_cents  bigint not null default 0,
  status         text not null default 'open',    -- open | accepted | declined | settled
  opened_on      date not null default now()::date,
  decided_on     date,
  settled_cents  bigint,
  outcome        text,
  external_ref   text unique,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists claims_no_lower_idx on claims (lower(claim_no));

-- Notes and tasks ------------------------------------------------------------------

create table if not exists notes (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid references customers (id),
  consignment_id uuid references consignments (id),
  body           text not null,
  created_at     timestamptz not null default now()
);

create table if not exists tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  customer_id uuid references customers (id),
  due_on      date,
  status      text not null default 'open',  -- open | done
  done_on     date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- updated_at triggers ---------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['customers','drivers','vehicles','rate_cards','runs','consignments','invoices','claims','tasks'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end
$$;

-- Views -----------------------------------------------------------------------
-- Everything that talks about the same money or the same freight reads the
-- same view, so two commands can never disagree.

-- The board: every consignment that is not finished with, plus the fresh
-- deliveries the office still works (POD chase, billing).
create or replace view v_board as
select
  c.id, c.con_no, c.customer_ref, cu.id as customer_id, cu.name as customer, cu.on_stop,
  c.origin_zone, c.dest_zone, c.service, c.items, c.pallets, c.weight_kg,
  c.dangerous_goods, c.status, c.booked_on, c.required_by,
  r.run_no, r.run_date, d.full_name as driver,
  c.picked_up_at, c.delivered_at, c.pod_name, c.pod_at, c.exception,
  c.charge_cents, c.rate_desc, c.invoice_id,
  case when c.status not in ('delivered', 'cancelled') and c.required_by is not null and c.required_by < now()::date
       then (now()::date - c.required_by) end as days_late,
  case when c.status = 'booked' then (now()::date - c.booked_on) end as days_unassigned
from consignments c
join customers cu on cu.id = c.customer_id
left join runs r on r.id = c.run_id
left join drivers d on d.id = r.driver_id;

-- Delivered freight with no signed POD behind it. Billing is blocked on
-- every row here, which is why the list is the office's first job of the day.
create or replace view v_pod_gap as
select b.id, b.con_no, b.customer, b.receiver_name, b.dest_zone, b.delivered_at, b.charge_cents, b.run_no, b.driver,
       (now()::date - b.delivered_at::date) as days_waiting
from (select v.*, c.receiver_name from v_board v join consignments c on c.id = v.id) b
where b.status = 'delivered' and (b.pod_name is null or b.pod_name = '' or b.pod_at is null);

-- Delivered, POD in hand, not yet on an invoice: the money asleep.
create or replace view v_unbilled as
select b.id, b.con_no, b.customer_id, b.customer, b.dest_zone, b.service, b.delivered_at,
       b.charge_cents, b.rate_desc,
       (now()::date - b.delivered_at::date) as days_unbilled
from v_board b
where b.status = 'delivered' and b.invoice_id is null
  and b.pod_name is not null and b.pod_name <> '' and b.pod_at is not null;

-- Freight that booked with no matching rate: moving for free until someone rates it.
create or replace view v_rate_gap as
select b.id, b.con_no, b.customer, b.origin_zone, b.dest_zone, b.service, b.weight_kg, b.pallets, b.status, b.booked_on
from v_board b
where b.rate_desc is null and b.status <> 'cancelled';

-- The run board: stops, weight against the truck's rated payload, work time.
create or replace view v_run_board as
select
  r.id, r.run_no, r.name, r.run_date, r.status,
  d.full_name as driver, d.dg_endorsed,
  v.fleet_no, v.rego, v.max_payload_kg,
  r.depart_at, r.return_at, r.break_minutes,
  case when r.depart_at is not null and r.return_at is not null
       then round(extract(epoch from (r.return_at - r.depart_at)) / 60)::integer end as span_minutes,
  (select count(*) from consignments c where c.run_id = r.id and c.status <> 'cancelled') as stops,
  (select coalesce(sum(c.weight_kg), 0) from consignments c where c.run_id = r.id and c.status <> 'cancelled') as load_kg,
  (select bool_or(c.dangerous_goods) from consignments c where c.run_id = r.id and c.status <> 'cancelled') as has_dg,
  case when v.max_payload_kg > 0
       then round(100.0 * (select coalesce(sum(c.weight_kg), 0) from consignments c where c.run_id = r.id and c.status <> 'cancelled') / v.max_payload_kg)::integer
       end as load_pct
from runs r
left join drivers d on d.id = r.driver_id
left join vehicles v on v.id = r.vehicle_id;

-- A driver's day: the work-time record the logbook rules read. net_minutes is
-- span minus recorded breaks; a day over 13 hours of work, or any single run
-- over 5.5 hours with no recorded break, is a breach, not a preference.
create or replace view v_driver_day as
select
  d.id as driver_id, d.full_name as driver, r.run_date,
  count(*) as runs,
  sum(case when r.depart_at is not null and r.return_at is not null
           then round(extract(epoch from (r.return_at - r.depart_at)) / 60)::integer else 0 end) as span_minutes,
  sum(r.break_minutes) as break_minutes,
  sum(case when r.depart_at is not null and r.return_at is not null
           then round(extract(epoch from (r.return_at - r.depart_at)) / 60)::integer else 0 end) - sum(r.break_minutes) as work_minutes,
  bool_or(
    r.depart_at is not null and r.return_at is not null and r.break_minutes = 0
    and extract(epoch from (r.return_at - r.depart_at)) / 60 > 330
  ) as no_break_run
from runs r
join drivers d on d.id = r.driver_id
group by d.id, d.full_name, r.run_date;

-- The fleet and its clocks.
create or replace view v_fleet as
select
  v.id, v.fleet_no, v.rego, v.description, v.vehicle_class, v.max_payload_kg,
  v.cof_due_on, (v.cof_due_on - now()::date) as cof_days,
  v.rego_due_on, (v.rego_due_on - now()::date) as rego_days,
  v.ruc_paid_to_km, v.hubodometer_km,
  case when v.ruc_paid_to_km is not null and v.hubodometer_km is not null
       then v.ruc_paid_to_km - v.hubodometer_km end as ruc_remaining_km,
  v.active, v.note
from vehicles v;

-- DIFOT per customer, last 28 days of deliveries: delivered in full (no
-- exception at the door) and on time (against required_by).
create or replace view v_difot as
select
  cu.id as customer_id, cu.name as customer,
  count(*) as delivered,
  count(*) filter (where c.required_by is null or c.delivered_at::date <= c.required_by) as on_time,
  count(*) filter (where c.exception is null) as in_full,
  count(*) filter (where (c.required_by is null or c.delivered_at::date <= c.required_by) and c.exception is null) as difot,
  round(100.0 * count(*) filter (where (c.required_by is null or c.delivered_at::date <= c.required_by) and c.exception is null) / count(*))::integer as difot_pct
from consignments c
join customers cu on cu.id = c.customer_id
where c.status = 'delivered' and c.delivered_at >= now() - interval '28 days'
group by cu.id, cu.name;

-- Debtors, aged.
create or replace view v_debtors as
select
  i.id, i.number, cu.name as customer, i.issued_on, i.due_on, i.status, i.total_cents,
  case when i.status = 'sent' and i.due_on < now()::date then (now()::date - i.due_on) end as days_overdue,
  case
    when i.status <> 'sent' then null
    when i.due_on >= now()::date then 'current'
    when now()::date - i.due_on <= 30 then '1-30'
    when now()::date - i.due_on <= 60 then '31-60'
    else '60+'
  end as bucket
from invoices i
join customers cu on cu.id = i.customer_id
where i.status <> 'paid';

-- Customer exposure: what they owe plus delivered freight not yet billed,
-- against the credit limit.
create or replace view v_customer_position as
select
  cu.id as customer_id, cu.name as customer, cu.terms_days, cu.credit_limit_cents, cu.on_stop, cu.status,
  coalesce((select sum(i.total_cents) from invoices i where i.customer_id = cu.id and i.status = 'sent'), 0) as owing_cents,
  coalesce((select sum(u.charge_cents) from v_unbilled u where u.customer_id = cu.id), 0) as unbilled_cents,
  coalesce((select sum(i.total_cents) from invoices i where i.customer_id = cu.id and i.status = 'sent'), 0)
    + coalesce((select sum(u.charge_cents) from v_unbilled u where u.customer_id = cu.id), 0) as exposure_cents,
  (select count(*) from consignments c where c.customer_id = cu.id and c.status not in ('delivered', 'cancelled')) as open_cons
from customers cu;

-- Everything that wants a decision, worst first. One row per problem, with a
-- reason code the CLI and the views translate into words.
create or replace view v_attention as
select * from (

  -- Dangerous goods on a run whose driver holds no D endorsement.
  select 'dg_unendorsed' as reason, b.con_no as label, b.customer, b.driver as who,
         null::integer as days, b.charge_cents as amount_cents,
         (b.run_no || ': DG class ' || coalesce((select dg_class from consignments where id = b.id), '?') || ' with an unendorsed driver') as detail
  from v_board b
  join runs r on r.run_no = b.run_no
  join drivers d on d.id = r.driver_id
  where b.dangerous_goods and not d.dg_endorsed and b.status in ('assigned', 'picked-up')

  union all
  -- A run loaded past the truck's rated payload.
  select 'overloaded_run', rb.run_no, null, rb.driver, null,
         null,
         (rb.load_kg || ' kg on ' || rb.fleet_no || ' rated ' || rb.max_payload_kg || ' kg (' || rb.load_pct || '%)')
  from v_run_board rb
  where rb.status in ('planned', 'out') and rb.max_payload_kg > 0 and rb.load_kg > rb.max_payload_kg

  union all
  -- Work time: a day over 13 hours, or a long run with no recorded break, last 14 days.
  select 'worktime_breach', dd.driver, null, dd.driver,
         (now()::date - dd.run_date),
         null,
         (to_char(dd.run_date, 'YYYY-MM-DD') || ': ' ||
          case when dd.work_minutes > 780 then round(dd.work_minutes / 60.0, 1) || 'h work in the day'
               else 'over 5.5h continuous with no recorded break' end)
  from v_driver_day dd
  where dd.run_date >= now()::date - 14 and (dd.work_minutes > 780 or dd.no_break_run)

  union all
  -- COF or rego overdue or due within 14 days.
  select 'fleet_cert_due', f.fleet_no, null, null,
         least(coalesce(f.cof_days, 999), coalesce(f.rego_days, 999)),
         null,
         trim(both ' ' from
           case when f.cof_days is not null and f.cof_days <= 14
                then 'COF ' || case when f.cof_days < 0 then abs(f.cof_days) || 'd OVERDUE' else 'due in ' || f.cof_days || 'd' end || '. ' else '' end ||
           case when f.rego_days is not null and f.rego_days <= 14
                then 'Rego ' || case when f.rego_days < 0 then abs(f.rego_days) || 'd OVERDUE' else 'due in ' || f.rego_days || 'd' end else '' end)
  from v_fleet f
  where f.active and ((f.cof_days is not null and f.cof_days <= 14) or (f.rego_days is not null and f.rego_days <= 14))

  union all
  -- RUC licence nearly used up.
  select 'ruc_low', f.fleet_no, null, null, null, null,
         (f.ruc_remaining_km || ' km left on the RUC licence (hubo ' || f.hubodometer_km || ', paid to ' || f.ruc_paid_to_km || ')')
  from v_fleet f
  where f.active and f.ruc_remaining_km is not null and f.ruc_remaining_km < 1000

  union all
  -- Not delivered, past the required date.
  select 'late_delivery', b.con_no, b.customer, b.driver, b.days_late, b.charge_cents,
         (b.origin_zone || ' to ' || b.dest_zone || ', required ' || to_char(b.required_by, 'YYYY-MM-DD') || ', status ' || b.status)
  from v_board b
  where b.days_late is not null and b.days_late > 0

  union all
  -- Booked and going nowhere: no run after 2+ days.
  select 'consignment_stuck', b.con_no, b.customer, null, b.days_unassigned, b.charge_cents,
         (b.origin_zone || ' to ' || b.dest_zone || ', booked ' || to_char(b.booked_on, 'YYYY-MM-DD') || ', on no run')
  from v_board b
  where b.days_unassigned is not null and b.days_unassigned >= 2

  union all
  -- Delivered with no POD: billing blocked.
  select 'pod_missing', p.con_no, p.customer, p.driver, p.days_waiting, p.charge_cents,
         ('delivered ' || to_char(p.delivered_at, 'YYYY-MM-DD') || ' on ' || coalesce(p.run_no, '?') || ', no signed POD')
  from v_pod_gap p

  union all
  -- Delivered with an exception at the door and no claim opened.
  select 'exception_no_claim', c.con_no, cu.name, null,
         (now()::date - c.delivered_at::date), c.charge_cents,
         (c.exception || coalesce(': ' || c.exception_note, '') || ', no claim on record')
  from consignments c
  join customers cu on cu.id = c.customer_id
  where c.status = 'delivered' and c.exception is not null
    and not exists (select 1 from claims cl where cl.consignment_id = c.id)

  union all
  -- POD in hand, still not billed after 3 days.
  select 'unbilled_delivered', u.con_no, u.customer, null, u.days_unbilled, u.charge_cents,
         ('delivered ' || to_char(u.delivered_at, 'YYYY-MM-DD') || ', POD in hand, on no invoice')
  from v_unbilled u
  where u.days_unbilled >= 3

  union all
  -- Booked with no rate: moving for free.
  select 'rate_missing', g.con_no, g.customer, null, (now()::date - g.booked_on), null,
         (g.origin_zone || ' to ' || g.dest_zone || ' ' || g.service || ', no rate card matched: charge is $0')
  from v_rate_gap g

  union all
  -- An open cargo claim going stale against the Act's windows.
  select 'claim_open', cl.claim_no, cu.name, null, (now()::date - cl.opened_on), cl.claimed_cents,
         (cl.kind || ' on ' || c.con_no || ', open ' || (now()::date - cl.opened_on) || ' days, undecided')
  from claims cl
  join consignments c on c.id = cl.consignment_id
  join customers cu on cu.id = c.customer_id
  where cl.status = 'open'

  union all
  -- Invoices overdue.
  select 'invoice_overdue', d.number, d.customer, null, d.days_overdue, d.total_cents,
         ('due ' || to_char(d.due_on, 'YYYY-MM-DD') || ' (' || d.bucket || ')')
  from v_debtors d
  where d.days_overdue is not null and d.days_overdue > 0

  union all
  -- Drafts that never went out.
  select 'invoice_draft', d.number, d.customer, null, (now()::date - d.issued_on), d.total_cents,
         ('drafted ' || to_char(d.issued_on, 'YYYY-MM-DD') || ', never sent')
  from v_debtors d
  where d.status = 'draft' and (now()::date - d.issued_on) >= 3

  union all
  -- Exposure past the limit.
  select 'over_credit_limit', cp.customer, cp.customer, null, null, cp.exposure_cents,
         ('owing ' || to_char(cp.owing_cents / 100.0, 'FM$999,999,990') || ' + unbilled ' ||
          to_char(cp.unbilled_cents / 100.0, 'FM$999,999,990') || ' against a limit of ' ||
          to_char(cp.credit_limit_cents / 100.0, 'FM$999,999,990'))
  from v_customer_position cp
  where cp.credit_limit_cents is not null and cp.exposure_cents > cp.credit_limit_cents

  union all
  -- Tasks past their date.
  select 'task_overdue', t.title, cu.name, null, (now()::date - t.due_on), null,
         ('due ' || to_char(t.due_on, 'YYYY-MM-DD'))
  from tasks t
  left join customers cu on cu.id = t.customer_id
  where t.status = 'open' and t.due_on is not null and t.due_on < now()::date

) a;
