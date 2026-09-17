-- Demo data for freight-ops-for-claude-code.
-- Tui Freight Lines, a fictional Palmerston North general carrier: 5 drivers,
-- 6 trucks and vans, 12 account customers, a standard tariff plus two customer
-- rate cards, 6 runs, 27 consignments from booked to delivered, six invoices
-- and two cargo claims.
--
-- Deliberately messy, so the attention list has something to say:
--   three delivered consignments with no signed POD, the oldest 9 days
--   $1,514 of delivered POD-backed freight sitting on no invoice
--   a delivery signed with damage at the door and no claim opened
--   a booked consignment on no run for 4 days, and two past their required date
--   a Nelson consignment that booked with no matching rate: moving for $0
--   dangerous goods (class 3) on today's metro run with an unendorsed driver
--   the same run loaded 8,450 kg on a truck rated 8,000
--   T-02's COF 8 days overdue, T-03's rego due in 10, 400 km left on T-01's RUC
--   a 6-hour run three days ago with no recorded break (and a 13.5h day, older)
--   INV-2040 ($12,400) 32 days overdue, INV-2041 12 days, a draft never sent
--   CLM-30 ($1,850 damage claim) open and undecided for 19 days
--   Manawatu Fresh over its $12,000 limit, and Rangitikei Timber on stop
--   the rate review task 3 days past its date
--
-- Dates are relative to current_date. Ids are derived from names with
-- seed_uuid, and every insert is ON CONFLICT DO NOTHING, so running it twice
-- changes nothing.
--
-- Rates and names are DEMO VALUES for a fictional company. No real business
-- or person is depicted, and nothing here is legal advice.

create or replace function seed_uuid(seed text) returns uuid language sql immutable as $$
  select (substr(m, 1, 8) || '-' || substr(m, 9, 4) || '-4' || substr(m, 13, 3)
          || '-8' || substr(m, 16, 3) || '-' || substr(m, 19, 12))::uuid
  from (select md5(seed) as m) s
$$;

-- Customers -------------------------------------------------------------------

insert into customers (id, name, code, contact_name, email, phone, city, terms_days, credit_limit_cents, fuel_levy_pct, on_stop, status, note, external_ref) values
  (seed_uuid('cust:manawatufresh'), 'Manawatu Fresh Produce Ltd',      'MFP001', 'Karen Tapa',    'accounts@manawatufresh.example.nz', '06 555 0501', 'Palmerston North', 20, 1200000, 12.5, false, 'active', null, 'TV-C001'),
  (seed_uuid('cust:kapitibev'),     'Kapiti Beverage Co Ltd',          'KBC001', 'Josh Millar',   'josh@kapitibev.example.nz',         '04 555 0502', 'Paraparaumu',      20, 2500000, 10,   false, 'active', null, 'TV-C002'),
  (seed_uuid('cust:rangitikei'),    'Rangitikei Timber & Hardware Ltd','RTH001', 'Gary Solomon',  'gary@rangitikeitimber.example.nz',  '06 555 0503', 'Marton',           20, 800000,  12.5, true,  'active', 'On stop until the July account settles.', 'TV-C003'),
  (seed_uuid('cust:horowhenua'),    'Horowhenua Joinery Ltd',          'HJL001', 'Mere Ropata',   'office@horowhenuajoinery.example.nz','06 555 0504', 'Levin',           20, 1000000, 12.5, false, 'active', null, 'TV-C004'),
  (seed_uuid('cust:centralag'),     'Central Ag Supplies Ltd',         'CAS001', 'Piet Vos',      'piet@centralag.example.nz',         '06 555 0505', 'Feilding',         20, 1500000, 12.5, false, 'active', null, 'TV-C005'),
  (seed_uuid('cust:ruapehu'),       'Ruapehu Outdoor Wholesale Ltd',   'ROW001', 'Sophie Lang',   'sophie@ruapehuoutdoor.example.nz',  '07 555 0506', 'Ohakune',          20, 600000,  12.5, false, 'active', null, 'TV-C006'),
  (seed_uuid('cust:tekawau'),       'Te Kawau Dairy Co-op',            'TKD001', 'Hemi Turner',   'hemi@tekawaudairy.example.nz',      '06 555 0507', 'Rongotea',         30, 2000000, 10,   false, 'active', null, 'TV-C007'),
  (seed_uuid('cust:foxton'),        'Foxton Furniture Traders Ltd',    'FFT001', 'Dion Paki',     'dion@foxtonfurniture.example.nz',   '06 555 0508', 'Foxton',           20, 500000,  12.5, false, 'active', null, 'TV-C008'),
  (seed_uuid('cust:tararua'),       'Tararua Brewing Co Ltd',          'TBC001', 'Bex Naera',     'bex@tararuabrewing.example.nz',     '06 555 0509', 'Pahiatua',         20, 700000,  12.5, false, 'active', null, 'TV-C009'),
  (seed_uuid('cust:levinpet'),      'Levin Pet & Feed Ltd',            'LPF001', 'Nga Parata',    'nga@levinpetfeed.example.nz',       '06 555 0510', 'Levin',            20, 400000,  12.5, false, 'active', null, 'TV-C010'),
  (seed_uuid('cust:whanganui'),     'Whanganui Marine Ltd',            'WML001', 'Stu Hape',      'stu@whanganuimarine.example.nz',    '06 555 0511', 'Whanganui',        20, 600000,  12.5, false, 'active', null, 'TV-C011'),
  (seed_uuid('cust:sanson'),        'Sanson Steel Fabricators Ltd',    'SSF001', 'Ana Malieva',   'ana@sansonsteel.example.nz',        '06 555 0512', 'Sanson',           20, 900000,  12.5, false, 'active', null, 'TV-C012')
on conflict do nothing;

-- Drivers -------------------------------------------------------------------
-- Dean holds no D endorsement: the seed puts dangerous goods on his run
-- anyway, exactly the record you inherit from a paper system.

insert into drivers (id, full_name, code, phone, licence_class, dg_endorsed, base, active, external_ref) values
  (seed_uuid('drv:mike'),  'Mike Tairea',    'MT', '021 555 601', 'Class 5', true,  'Palmerston North', true, 'TV-D001'),
  (seed_uuid('drv:aroha'), 'Aroha Waititi',  'AW', '021 555 602', 'Class 5', true,  'Palmerston North', true, 'TV-D002'),
  (seed_uuid('drv:dean'),  'Dean Kereama',   'DK', '021 555 603', 'Class 4', false, 'Palmerston North', true, 'TV-D003'),
  (seed_uuid('drv:sione'), 'Sione Tuilagi',  'ST', '021 555 604', 'Class 5', false, 'Palmerston North', true, 'TV-D004'),
  (seed_uuid('drv:bex'),   'Bex Hardy',      'BH', '021 555 605', 'Class 2', false, 'Palmerston North', true, 'TV-D005')
on conflict do nothing;

-- Vehicles -------------------------------------------------------------------
-- T-02's COF is 8 days overdue, T-03's rego is due in 10, and T-01 has 400 km
-- left on its RUC licence: three deliberate clock breaches.

insert into vehicles (id, fleet_no, rego, description, vehicle_class, max_payload_kg, cof_due_on, rego_due_on, ruc_paid_to_km, hubodometer_km, active, note, external_ref) values
  (seed_uuid('veh:t01'), 'T-01', 'KFD482', 'Hino 700 curtainsider',        'truck',         12000, current_date + 95,  current_date + 200, 482000, 481600, true, null, 'TV-V001'),
  (seed_uuid('veh:t02'), 'T-02', 'LHR209', 'Isuzu F-series curtainsider',  'truck',          8000, current_date - 8,   current_date + 140, 361000, 344800, true, null, 'TV-V002'),
  (seed_uuid('veh:t03'), 'T-03', 'MCW551', 'Fuso Fighter flatdeck',        'truck',          7500, current_date + 40,  current_date + 10,  298000, 287100, true, null, 'TV-V003'),
  (seed_uuid('veh:t04'), 'T-04', 'NPT117', 'Scania R500 and trailer',      'truck-trailer', 26000, current_date + 150, current_date + 300, 655000, 612400, true, null, 'TV-V004'),
  (seed_uuid('veh:v05'), 'V-05', 'PDQ838', 'Toyota Hiace (petrol)',        'van',            1400, current_date + 120, current_date + 90,  null,   null,   true, 'Petrol: no RUC licence.', 'TV-V005'),
  (seed_uuid('veh:t06'), 'T-06', 'QBX414', 'UD Croner curtainsider',       'truck',          9000, current_date + 70,  current_date + 240, 421000, 398500, true, null, 'TV-V006')
on conflict do nothing;

-- Rate cards -------------------------------------------------------------------
-- The standard tariff (customer_id null) plus two customer cards that beat it.
-- There is deliberately NO card for PMR to NSN: CON-1313 books at $0.

insert into rate_cards (id, customer_id, origin_zone, dest_zone, service, basis, rate_cents, min_charge_cents, effective_on, external_ref) values
  (seed_uuid('rate:std-pmr-wlg'),  null,                             'PMR', 'WLG', 'general',   'per_kg',     18,  3500, current_date - 200, 'TV-R001'),
  (seed_uuid('rate:std-pmr-akl'),  null,                             'PMR', 'AKL', 'general',   'per_kg',     24,  4500, current_date - 200, 'TV-R002'),
  (seed_uuid('rate:std-pmr-akl-o'),null,                             'PMR', 'AKL', 'overnight', 'per_kg',     32,  6500, current_date - 200, 'TV-R003'),
  (seed_uuid('rate:std-pmr-ham'),  null,                             'PMR', 'HAM', 'general',   'per_kg',     20,  4000, current_date - 200, 'TV-R004'),
  (seed_uuid('rate:std-pmr-wan'),  null,                             'PMR', 'WAN', 'general',   'per_pallet', 5500, 5500, current_date - 200, 'TV-R005'),
  (seed_uuid('rate:std-pmr-npe'),  null,                             'PMR', 'NPE', 'general',   'per_kg',     22,  4000, current_date - 200, 'TV-R006'),
  (seed_uuid('rate:std-wlg-pmr'),  null,                             'WLG', 'PMR', 'general',   'per_kg',     18,  3500, current_date - 200, 'TV-R007'),
  (seed_uuid('rate:std-pmr-pmr'),  null,                             'PMR', 'PMR', 'general',   'per_item',   1800, 1800, current_date - 200, 'TV-R008'),
  (seed_uuid('rate:mfp-pmr-wlg'),  seed_uuid('cust:manawatufresh'),  'PMR', 'WLG', 'general',   'per_pallet', 4800, 4800, current_date - 90,  'TV-R009'),
  (seed_uuid('rate:kbc-pmr-akl'),  seed_uuid('cust:kapitibev'),      'PMR', 'AKL', 'general',   'per_kg',     21,  5200, current_date - 90,  'TV-R010')
on conflict do nothing;

-- Runs -------------------------------------------------------------------
-- RUN-401 is a 13.5 hour day (16 days back, history now). RUN-402 is 6h15m
-- with no recorded break, 3 days back: inside the work-time rule's window.
-- RUN-410 is today's metro run: overloaded AND carrying DG with Dean.

insert into runs (id, run_no, name, run_date, driver_id, vehicle_id, status, depart_at, return_at, break_minutes, note, external_ref) values
  (seed_uuid('run:401'), 'RUN-401', 'AKL linehaul',   current_date - 16, seed_uuid('drv:aroha'), seed_uuid('veh:t01'), 'done',    current_date - 16 + time '06:30', current_date - 16 + time '20:00', 0,  'Turnaround blowout at the Otahuhu depot.', 'TV-N401'),
  (seed_uuid('run:402'), 'RUN-402', 'WAN and back',   current_date - 3,  seed_uuid('drv:dean'),  seed_uuid('veh:t03'), 'done',    current_date - 3 + time '07:00',  current_date - 3 + time '13:15',  0,  null, 'TV-N402'),
  (seed_uuid('run:403'), 'RUN-403', 'WLG linehaul',   current_date - 2,  seed_uuid('drv:mike'),  seed_uuid('veh:t01'), 'done',    current_date - 2 + time '06:00',  current_date - 2 + time '15:30',  45, null, 'TV-N403'),
  (seed_uuid('run:410'), 'RUN-410', 'PMR metro AM',   current_date,      seed_uuid('drv:dean'),  seed_uuid('veh:t02'), 'planned', null, null, 0, null, 'TV-N410'),
  (seed_uuid('run:411'), 'RUN-411', 'WLG linehaul',   current_date,      seed_uuid('drv:aroha'), seed_uuid('veh:t04'), 'planned', null, null, 0, null, 'TV-N411'),
  (seed_uuid('run:412'), 'RUN-412', 'AKL overnight',  current_date + 1,  seed_uuid('drv:sione'), seed_uuid('veh:t06'), 'planned', null, null, 0, null, 'TV-N412')
on conflict do nothing;

-- Consignments -------------------------------------------------------------------
-- Historic, delivered and invoiced (the DIFOT record and the paid history).

insert into consignments (id, con_no, customer_id, customer_ref, sender_name, origin_address, origin_zone, receiver_name, dest_address, dest_zone, service, items, pallets, weight_kg, dangerous_goods, dg_class, status, booked_on, required_by, run_id, drop_order, picked_up_at, delivered_at, pod_name, pod_at, exception, exception_note, charge_cents, rate_desc, external_ref) values
  (seed_uuid('con:1281'), 'CON-1281', seed_uuid('cust:manawatufresh'), 'MF-8811', 'Manawatu Fresh Produce', 'Railway Rd, Palmerston North', 'PMR', 'Moore Wilsons Wellington',   'Tory St, Wellington', 'WLG', 'general', 12, 6, 3100, false, null, 'delivered', current_date - 26, current_date - 24, null, null, current_date - 25 + time '07:10', current_date - 24 + time '10:40', 'R. Aporo',   current_date - 24 + time '10:40', null, null, 28800, 'Manawatu Fresh card PMR-WLG per pallet', 'TV-1281'),
  (seed_uuid('con:1282'), 'CON-1282', seed_uuid('cust:manawatufresh'), 'MF-8817', 'Manawatu Fresh Produce', 'Railway Rd, Palmerston North', 'PMR', 'Commonsense Wellington',     'Adelaide Rd, Wellington', 'WLG', 'general', 8, 4, 2050, false, null, 'delivered', current_date - 20, current_date - 18, null, null, current_date - 19 + time '07:05', current_date - 18 + time '11:20', 'T. Field',   current_date - 18 + time '11:20', null, null, 19200, 'Manawatu Fresh card PMR-WLG per pallet', 'TV-1282'),
  (seed_uuid('con:1283'), 'CON-1283', seed_uuid('cust:manawatufresh'), 'MF-8824', 'Manawatu Fresh Produce', 'Railway Rd, Palmerston North', 'PMR', 'Harbour City Market',        'Cable St, Wellington', 'WLG', 'general', 10, 5, 2600, false, null, 'delivered', current_date - 13, current_date - 12, null, null, current_date - 12 + time '07:00', current_date - 11 + time '09:10', 'B. Leota',   current_date - 11 + time '09:10', null, 'Arrived a day late: linehaul left without it.', 24000, 'Manawatu Fresh card PMR-WLG per pallet', 'TV-1283'),
  (seed_uuid('con:1284'), 'CON-1284', seed_uuid('cust:manawatufresh'), 'MF-8829', 'Manawatu Fresh Produce', 'Railway Rd, Palmerston North', 'PMR', 'Moore Wilsons Wellington',   'Tory St, Wellington', 'WLG', 'general', 9, 4, 2200, false, null, 'delivered', current_date - 9,  current_date - 8,  null, null, current_date - 8 + time '07:15',  current_date - 8 + time '10:55', 'R. Aporo',   current_date - 8 + time '10:55', 'shortage', 'One pallet of 5 short at the dock; sent on the next run.', 19200, 'Manawatu Fresh card PMR-WLG per pallet', 'TV-1284'),
  (seed_uuid('con:1285'), 'CON-1285', seed_uuid('cust:kapitibev'),     'KB-2201', 'Kapiti Beverage Co',     'Milne Dr, Paraparaumu',        'PMR', 'Federal Merchants Auckland', 'Neilson St, Onehunga', 'AKL', 'general', 22, 11, 5400, false, null, 'delivered', current_date - 22, current_date - 20, null, null, current_date - 21 + time '05:40', current_date - 20 + time '14:05', 'J. Nand',    current_date - 20 + time '14:05', null, null, 113400, 'Kapiti Beverage card PMR-AKL per kg', 'TV-1285'),
  (seed_uuid('con:1286'), 'CON-1286', seed_uuid('cust:kapitibev'),     'KB-2214', 'Kapiti Beverage Co',     'Milne Dr, Paraparaumu',        'PMR', 'Glengarry Victoria Park',    'Wellesley St, Auckland', 'AKL', 'general', 14, 7, 3300, false, null, 'delivered', current_date - 14, current_date - 12, null, null, current_date - 13 + time '05:35', current_date - 12 + time '13:20', 'S. Curtis',  current_date - 12 + time '13:20', null, null, 69300, 'Kapiti Beverage card PMR-AKL per kg', 'TV-1286'),
  (seed_uuid('con:1287'), 'CON-1287', seed_uuid('cust:centralag'),     'CA-5501', 'Central Ag Supplies',    'Kawakawa Rd, Feilding',        'PMR', 'PGG Wrightson Hastings',     'Omahu Rd, Hastings', 'NPE', 'general', 6, 3, 1500, false, null, 'delivered', current_date - 17, current_date - 15, null, null, current_date - 16 + time '08:00', current_date - 15 + time '12:45', 'K. Tahana',  current_date - 15 + time '12:45', null, null, 33000, 'Standard PMR-NPE per kg', 'TV-1287'),
  (seed_uuid('con:1288'), 'CON-1288', seed_uuid('cust:tararua'),       'TB-0907', 'Tararua Brewing Co',     'Main St, Pahiatua',            'PMR', 'Star Liquor Whanganui',      'Victoria Ave, Whanganui', 'WAN', 'general', 4, 2, 900, false, null, 'delivered', current_date - 11, current_date - 10, null, null, current_date - 10 + time '08:30', current_date - 10 + time '13:10', 'M. Duncan',  current_date - 10 + time '13:10', null, null, 11000, 'Standard PMR-WAN per pallet', 'TV-1288')
on conflict do nothing;

-- The damage that became CLM-30: delivered 19 days ago, glass smashed at the door.
insert into consignments (id, con_no, customer_id, customer_ref, sender_name, origin_address, origin_zone, receiver_name, dest_address, dest_zone, service, items, pallets, weight_kg, dangerous_goods, dg_class, status, booked_on, required_by, run_id, drop_order, picked_up_at, delivered_at, pod_name, pod_at, exception, exception_note, charge_cents, rate_desc, external_ref) values
  (seed_uuid('con:1289'), 'CON-1289', seed_uuid('cust:kapitibev'),     'KB-2188', 'Kapiti Beverage Co',     'Milne Dr, Paraparaumu',        'PMR', 'Federal Merchants Auckland', 'Neilson St, Onehunga', 'AKL', 'general', 18, 9, 4200, false, null, 'delivered', current_date - 21, current_date - 19, null, null, current_date - 20 + time '05:45', current_date - 19 + time '13:50', 'J. Nand', current_date - 19 + time '13:50', 'damage', 'Two cartons of glassware crushed under a mispacked pallet.', 88200, 'Kapiti Beverage card PMR-AKL per kg', 'TV-1289')
on conflict do nothing;

-- Fresh deliveries with problems: no POD (billing blocked) or not yet billed.

insert into consignments (id, con_no, customer_id, customer_ref, sender_name, origin_address, origin_zone, receiver_name, dest_address, dest_zone, service, items, pallets, weight_kg, dangerous_goods, dg_class, status, booked_on, required_by, run_id, drop_order, picked_up_at, delivered_at, pod_name, pod_at, exception, exception_note, charge_cents, rate_desc, external_ref) values
  (seed_uuid('con:1301'), 'CON-1301', seed_uuid('cust:kapitibev'),     'KB-2230', 'Kapiti Beverage Co',     'Milne Dr, Paraparaumu',        'PMR', 'Federal Merchants Auckland', 'Neilson St, Onehunga', 'AKL', 'general', 8, 4, 1850, false, null, 'delivered', current_date - 10, current_date - 9, null, null, current_date - 9 + time '05:40', current_date - 9 + time '13:35', null, null, null, null, 38850, 'Kapiti Beverage card PMR-AKL per kg', 'TV-1301'),
  (seed_uuid('con:1302'), 'CON-1302', seed_uuid('cust:tekawau'),       'TK-7714', 'Te Kawau Dairy Co-op',   'Te Kawau Rd, Rongotea',        'PMR', 'Fonterra Longburn',          'Longburn, Palmerston North', 'PMR', 'general', 2, 1, 450, false, null, 'delivered', current_date - 4, current_date - 4, null, null, current_date - 4 + time '09:00', current_date - 4 + time '10:20', null, null, null, null, 3600, 'Standard PMR-PMR per item', 'TV-1302'),
  (seed_uuid('con:1303'), 'CON-1303', seed_uuid('cust:horowhenua'),    'HJ-3319', 'Horowhenua Joinery',     'Cambridge St, Levin',          'PMR', 'Wellington Kitchen Studio',  'Thorndon Quay, Wellington', 'WLG', 'general', 5, 2, 1150, false, null, 'delivered', current_date - 3, current_date - 2, seed_uuid('run:403'), 2, current_date - 2 + time '06:20', current_date - 2 + time '11:05', null, null, null, null, 20700, 'Standard PMR-WLG per kg', 'TV-1303'),
  (seed_uuid('con:1305'), 'CON-1305', seed_uuid('cust:foxton'),        'FF-1102', 'Foxton Furniture Traders','Main St, Foxton',             'PMR', 'Trade Depot Auckland',       'Wairau Rd, Glenfield', 'AKL', 'general', 6, 3, 1400, false, null, 'delivered', current_date - 13, current_date - 12, null, null, current_date - 12 + time '05:50', current_date - 12 + time '14:20', 'A. Prasad', current_date - 12 + time '14:20', null, null, 33600, 'Standard PMR-AKL per kg', 'TV-1305'),
  (seed_uuid('con:1306'), 'CON-1306', seed_uuid('cust:sanson'),        'SS-4407', 'Sanson Steel Fabricators','State Highway 1, Sanson',     'PMR', 'Steel & Tube Wellington',    'Gracefield, Lower Hutt', 'WLG', 'general', 3, 2, 2900, false, null, 'delivered', current_date - 7, current_date - 6, null, null, current_date - 6 + time '06:10', current_date - 6 + time '10:30', 'P. Woods', current_date - 6 + time '10:30', null, null, 52200, 'Standard PMR-WLG per kg', 'TV-1306'),
  (seed_uuid('con:1307'), 'CON-1307', seed_uuid('cust:manawatufresh'), 'MF-8835', 'Manawatu Fresh Produce', 'Railway Rd, Palmerston North', 'PMR', 'Harbour City Market',        'Cable St, Wellington', 'WLG', 'general', 14, 7, 3600, false, null, 'delivered', current_date - 6, current_date - 5, null, null, current_date - 5 + time '07:05', current_date - 5 + time '10:15', 'B. Leota', current_date - 5 + time '10:15', null, null, 33600, 'Manawatu Fresh card PMR-WLG per pallet', 'TV-1307'),
  (seed_uuid('con:1308'), 'CON-1308', seed_uuid('cust:ruapehu'),       'RO-6612', 'Ruapehu Outdoor Wholesale','Goldfinch St, Ohakune',      'PMR', 'Hunting & Fishing Hamilton', 'Te Rapa Rd, Hamilton', 'HAM', 'general', 7, 3, 1600, false, null, 'delivered', current_date - 3, current_date - 2, seed_uuid('run:403'), 4, current_date - 2 + time '06:30', current_date - 2 + time '13:40', 'C. Ballard', current_date - 2 + time '13:40', 'damage', 'Carton of waders torn open and wet at the door.', 32000, 'Standard PMR-HAM per kg', 'TV-1308')
on conflict do nothing;

-- Open freight: stuck, late, unrated, and today's runs.

insert into consignments (id, con_no, customer_id, customer_ref, sender_name, origin_address, origin_zone, receiver_name, dest_address, dest_zone, service, items, pallets, weight_kg, dangerous_goods, dg_class, instructions, status, booked_on, required_by, run_id, drop_order, charge_cents, rate_desc, external_ref) values
  (seed_uuid('con:1310'), 'CON-1310', seed_uuid('cust:centralag'),  'CA-5522', 'Central Ag Supplies',     'Kawakawa Rd, Feilding',    'PMR', 'Farmlands Hastings',        'Omahu Rd, Hastings', 'NPE', 'general', 10, 5, 2400, false, null, null, 'booked', current_date - 4, current_date + 2, null, null, 52800, 'Standard PMR-NPE per kg', 'TV-1310'),
  (seed_uuid('con:1311'), 'CON-1311', seed_uuid('cust:horowhenua'), 'HJ-3325', 'Horowhenua Joinery',      'Cambridge St, Levin',      'PMR', 'Wellington Kitchen Studio', 'Thorndon Quay, Wellington', 'WLG', 'general', 4, 2, 950, false, null, 'Call the site foreman 30 minutes out.', 'assigned', current_date - 5, current_date - 2, seed_uuid('run:411'), 3, 17100, 'Standard PMR-WLG per kg', 'TV-1311'),
  (seed_uuid('con:1312'), 'CON-1312', seed_uuid('cust:rangitikei'), 'RT-9903', 'Rangitikei Timber',       'Broadway, Marton',         'PMR', 'Mitre 10 Mega Petone',      'Hutt Rd, Petone', 'WLG', 'general', 20, 10, 5200, false, null, null, 'on-hold', current_date - 8, current_date - 5, null, null, 93600, 'Standard PMR-WLG per kg', 'TV-1312'),
  (seed_uuid('con:1313'), 'CON-1313', seed_uuid('cust:whanganui'),  'WM-2210', 'Whanganui Marine',        'Victoria Ave, Whanganui',  'PMR', 'CWF Hamilton Nelson',       'Vickerman St, Nelson', 'NSN', 'general', 2, 1, 800, false, null, null, 'booked', current_date - 1, current_date + 3, null, null, 0, null, 'TV-1313')
on conflict do nothing;

-- RUN-410, today's metro: 8,450 kg on T-02 (rated 8,000), including class 3
-- dangerous goods with Dean, who holds no D endorsement.
insert into consignments (id, con_no, customer_id, customer_ref, sender_name, origin_address, origin_zone, receiver_name, dest_address, dest_zone, service, items, pallets, weight_kg, dangerous_goods, dg_class, instructions, status, booked_on, required_by, run_id, drop_order, charge_cents, rate_desc, external_ref) values
  (seed_uuid('con:1314'), 'CON-1314', seed_uuid('cust:tararua'),   'TB-0921', 'Tararua Brewing Co',    'Main St, Pahiatua',        'PMR', 'Caltex Rangitikei St',       'Rangitikei St, Palmerston North', 'PMR', 'general', 2, 1, 120, true, '3', 'Flammable liquid: cleaning solvent drums.', 'assigned', current_date - 1, current_date, seed_uuid('run:410'), 4, 3600, 'Standard PMR-PMR per item', 'TV-1314'),
  (seed_uuid('con:1315'), 'CON-1315', seed_uuid('cust:centralag'), 'CA-5530', 'Central Ag Supplies',   'Kawakawa Rd, Feilding',    'PMR', 'RD1 Ashhurst',               'Cambridge Ave, Ashhurst', 'PMR', 'general', 8, 4, 3200, false, null, null, 'assigned', current_date - 1, current_date, seed_uuid('run:410'), 1, 14400, 'Standard PMR-PMR per item', 'TV-1315'),
  (seed_uuid('con:1316'), 'CON-1316', seed_uuid('cust:levinpet'),  'LP-0808', 'Levin Pet & Feed',      'Oxford St, Levin',         'PMR', 'Animates Palmerston North',  'Rangitikei St, Palmerston North', 'PMR', 'general', 10, 5, 2600, false, null, null, 'assigned', current_date - 1, current_date, seed_uuid('run:410'), 2, 18000, 'Standard PMR-PMR per item', 'TV-1316'),
  (seed_uuid('con:1317'), 'CON-1317', seed_uuid('cust:foxton'),    'FF-1118', 'Foxton Furniture Traders','Main St, Foxton',        'PMR', 'Big Save Palmerston North',  'Main St, Palmerston North', 'PMR', 'general', 6, 3, 1730, false, null, null, 'assigned', current_date - 1, current_date, seed_uuid('run:410'), 3, 10800, 'Standard PMR-PMR per item', 'TV-1317'),
  (seed_uuid('con:1318'), 'CON-1318', seed_uuid('cust:sanson'),    'SS-4415', 'Sanson Steel Fabricators','State Highway 1, Sanson', 'PMR', 'Higgins Yard Kelvin Grove', 'El Prado Dr, Palmerston North', 'PMR', 'general', 2, 1, 800, false, null, null, 'assigned', current_date - 1, current_date, seed_uuid('run:410'), 5, 3600, 'Standard PMR-PMR per item', 'TV-1318'),
  (seed_uuid('con:1319'), 'CON-1319', seed_uuid('cust:tekawau'),   'TK-7720', 'Te Kawau Dairy Co-op',  'Te Kawau Rd, Rongotea',    'PMR', 'Moore Wilsons Wellington',   'Tory St, Wellington', 'WLG', 'general', 5, 2, 1100, false, null, null, 'assigned', current_date - 1, current_date + 1, seed_uuid('run:411'), 1, 19800, 'Standard PMR-WLG per kg', 'TV-1319'),
  (seed_uuid('con:1320'), 'CON-1320', seed_uuid('cust:kapitibev'), 'KB-2241', 'Kapiti Beverage Co',    'Milne Dr, Paraparaumu',    'PMR', 'Glengarry Victoria Park',    'Wellesley St, Auckland', 'AKL', 'overnight', 3, 1, 640, false, null, null, 'assigned', current_date, current_date + 1, seed_uuid('run:412'), 1, 20480, 'Standard PMR-AKL overnight per kg', 'TV-1320')
on conflict do nothing;

-- Invoices -------------------------------------------------------------------
-- INV-2040 is 32 days overdue on the over-limit account. INV-2042 is a draft
-- that never went out. The paid ones carry the history.

insert into invoices (id, number, customer_id, issued_on, due_on, status, total_cents, external_ref) values
  (seed_uuid('inv:2038'), 'INV-2038', seed_uuid('cust:centralag'),     current_date - 45, current_date - 25, 'paid', 186500,  'TV-I2038'),
  (seed_uuid('inv:2039'), 'INV-2039', seed_uuid('cust:tararua'),       current_date - 40, current_date - 20, 'paid', 12375,   'TV-I2039'),
  (seed_uuid('inv:2040'), 'INV-2040', seed_uuid('cust:manawatufresh'), current_date - 52, current_date - 32, 'sent', 1240000, 'TV-I2040'),
  (seed_uuid('inv:2041'), 'INV-2041', seed_uuid('cust:kapitibev'),     current_date - 32, current_date - 12, 'sent', 386000,  'TV-I2041'),
  (seed_uuid('inv:2042'), 'INV-2042', seed_uuid('cust:rangitikei'),    current_date - 6,  current_date + 14, 'draft', 215000, 'TV-I2042'),
  (seed_uuid('inv:2043'), 'INV-2043', seed_uuid('cust:horowhenua'),    current_date - 12, current_date + 8,  'sent', 74800,   'TV-I2043')
on conflict do nothing;

insert into invoice_lines (id, invoice_id, consignment_id, description, amount_cents) values
  (seed_uuid('il:2040-1'), seed_uuid('inv:2040'), null, 'Freight for the period: 41 consignments PMR to WLG', 1102222),
  (seed_uuid('il:2040-2'), seed_uuid('inv:2040'), null, 'Fuel levy 12.5%', 137778),
  (seed_uuid('il:2041-1'), seed_uuid('inv:2041'), seed_uuid('con:1285'), 'CON-1285 PMR to AKL, 5400 kg', 113400),
  (seed_uuid('il:2041-2'), seed_uuid('inv:2041'), seed_uuid('con:1289'), 'CON-1289 PMR to AKL, 4200 kg', 88200),
  (seed_uuid('il:2041-3'), seed_uuid('inv:2041'), seed_uuid('con:1286'), 'CON-1286 PMR to AKL, 3300 kg', 69300),
  (seed_uuid('il:2041-4'), seed_uuid('inv:2041'), null, 'Freight for the period: 3 further consignments', 80009),
  (seed_uuid('il:2041-5'), seed_uuid('inv:2041'), null, 'Fuel levy 10%', 35091),
  (seed_uuid('il:2042-1'), seed_uuid('inv:2042'), null, 'Freight for the period: 9 consignments', 191111),
  (seed_uuid('il:2042-2'), seed_uuid('inv:2042'), null, 'Fuel levy 12.5%', 23889),
  (seed_uuid('il:2043-1'), seed_uuid('inv:2043'), seed_uuid('con:1303'), 'CON-1303 PMR to WLG, 1150 kg', 20700),
  (seed_uuid('il:2043-2'), seed_uuid('inv:2043'), null, 'Freight for the period: 2 further consignments', 45785),
  (seed_uuid('il:2043-3'), seed_uuid('inv:2043'), null, 'Fuel levy 12.5%', 8315)
on conflict do nothing;

-- Mark the historic consignments billed (the fresh problem set stays unbilled).
update consignments set invoice_id = seed_uuid('inv:2041')
  where id in (seed_uuid('con:1285'), seed_uuid('con:1286'), seed_uuid('con:1289')) and invoice_id is null;
update consignments set invoice_id = seed_uuid('inv:2040')
  where id in (seed_uuid('con:1281'), seed_uuid('con:1282'), seed_uuid('con:1283'), seed_uuid('con:1284')) and invoice_id is null;
update consignments set invoice_id = seed_uuid('inv:2038')
  where id = seed_uuid('con:1287') and invoice_id is null;
update consignments set invoice_id = seed_uuid('inv:2039')
  where id = seed_uuid('con:1288') and invoice_id is null;

-- CON-1303 was invoiced on INV-2043 despite the missing POD: the paper system
-- let it through; the gate here will not. Leave it linked, the POD gap stands.
update consignments set invoice_id = seed_uuid('inv:2043')
  where id = seed_uuid('con:1303') and invoice_id is null;

-- Claims -------------------------------------------------------------------
-- CLM-30 has sat open and undecided for 19 days: the Act's windows are the
-- point of the compliance rule.

insert into claims (id, claim_no, consignment_id, kind, description, units, claimed_cents, status, opened_on, decided_on, settled_cents, outcome, external_ref) values
  (seed_uuid('clm:29'), 'CLM-29', seed_uuid('con:1284'), 'shortage', 'One pallet short at the dock; found and delivered next run.', 1, 42000, 'declined', current_date - 6, current_date - 5, null, 'Goods delivered complete the following day; no loss.', 'TV-CL29'),
  (seed_uuid('clm:30'), 'CLM-30', seed_uuid('con:1289'), 'damage', 'Two cartons of glassware crushed under a mispacked pallet.', 1, 185000, 'open', current_date - 19, null, null, null, 'TV-CL30')
on conflict do nothing;

-- Notes and tasks -------------------------------------------------------------------

insert into notes (id, customer_id, consignment_id, body, created_at) values
  (seed_uuid('note:1'), seed_uuid('cust:manawatufresh'), null, 'Karen called about INV-2040: promised payment by the 20th. Third promise.', now() - interval '8 days'),
  (seed_uuid('note:2'), seed_uuid('cust:kapitibev'), seed_uuid('con:1289'), 'Josh sent photos of the crushed cartons. Wants the claim decided before the next booking.', now() - interval '15 days'),
  (seed_uuid('note:3'), seed_uuid('cust:rangitikei'), null, 'Gary asked for release of the Petone load. Told him it moves when the account does.', now() - interval '2 days')
on conflict do nothing;

insert into tasks (id, title, customer_id, due_on, status) values
  (seed_uuid('task:1'), 'Send Manawatu Fresh the rate review letter', seed_uuid('cust:manawatufresh'), current_date - 3, 'open'),
  (seed_uuid('task:2'), 'Book T-02 in for its COF', null, current_date + 1, 'open')
on conflict do nothing;
