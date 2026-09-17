#!/usr/bin/env node
// Loads supabase/seed.sql: Tui Freight Lines, a fictional Palmerston North
// general carrier with 5 drivers, 6 vehicles, 12 account customers, rate
// cards, 6 runs, 27 consignments from booked to delivered, invoices and two
// cargo claims. Every row has a derived id and inserts with ON CONFLICT DO
// NOTHING, so re-running it is harmless.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';

export async function seed(db) {
  const sql = readFileSync(path.join(REPO_ROOT, 'supabase', 'seed.sql'), 'utf8');
  await db.exec(sql);
  const [c] = await db.query(`
    select (select count(*) from customers)     as customers,
           (select count(*) from drivers)       as drivers,
           (select count(*) from vehicles)      as vehicles,
           (select count(*) from rate_cards)    as rate_cards,
           (select count(*) from runs)          as runs,
           (select count(*) from consignments)  as consignments,
           (select count(*) from invoices)      as invoices,
           (select count(*) from invoice_lines) as invoice_lines,
           (select count(*) from claims)        as claims,
           (select count(*) from notes)         as notes,
           (select count(*) from tasks)         as tasks
  `);
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const db = await getDb();
  try {
    const n = await seed(db);
    console.log(
      `seed: ${n.customers} customers, ${n.drivers} drivers, ${n.vehicles} vehicles, ${n.rate_cards} rate cards, ` +
        `${n.runs} runs, ${n.consignments} consignments, ${n.invoices} invoices (${n.invoice_lines} lines), ` +
        `${n.claims} claims, ${n.notes} notes, ${n.tasks} tasks`,
    );
  } finally {
    await db.close();
  }
}
