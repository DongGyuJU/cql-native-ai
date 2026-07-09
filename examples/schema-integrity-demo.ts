// examples/schema-integrity-demo.ts
// Phase A in a recognizable, realistic setting: 번개마트's Store/Sku/Order
// data. Shows checkInstanceIsFunctor() (a) accepting a valid dataset,
// then (b) catching two real-shaped data-quality bugs in a broken one —
// a discontinued SKU still referenced by an open order (dangling
// reference / orphaned FK), and a newly-added SKU that never got
// assigned to a store (non-total morphism).
//
// Run: npx ts-node examples/schema-integrity-demo.ts

import { DomainSchema, InstanceBuilder, checkInstanceIsFunctor, describeSchema, describeMorphisms } from '../src';

// ── The Category: Store / Sku / Order, with the graph relations that
// actually hold in a delivery business (Sku stocked at a Store, Order
// placed for a Sku). ─────────────────────────────────────────────

const bungaeMartSchema: DomainSchema = {
  objects: {
    Store: { attributes: [{ name: 'name', type: 'string' }] },
    Sku: { attributes: [{ name: 'name', type: 'string' }, { name: 'quantity', type: 'number' }] },
    Order: { attributes: [{ name: 'placedAt', type: 'date' }] },
  },
  morphisms: [
    { name: 'stockedAt', from: 'Sku', to: 'Store' },
    { name: 'placedFor', from: 'Order', to: 'Sku' },
  ],
};

console.log('=== Schema (derived human-readable view) ===');
console.log(describeSchema(bungaeMartSchema));
console.log(describeMorphisms(bungaeMartSchema));

// ── A valid instance ─────────────────────────────────────────────

function goodInstance() {
  return new InstanceBuilder()
    .addRow('Store', { id: 'seongsu', name: '성수점' })
    .addRow('Store', { id: 'gangnam', name: '강남점' })
    .addRow('Sku', { id: 'water', name: '생수 2L', quantity: 3 })
    .addRow('Sku', { id: 'ramen', name: '컵라면', quantity: 12 })
    .addRow('Order', { id: 'o1001', placedAt: '2026-07-09T18:20:00' })
    .addRow('Order', { id: 'o1002', placedAt: '2026-07-09T18:21:00' })
    .setFk('stockedAt', 'water', 'seongsu')
    .setFk('stockedAt', 'ramen', 'gangnam')
    .setFk('placedFor', 'o1001', 'water')
    .setFk('placedFor', 'o1002', 'ramen')
    .build();
}

console.log('\n=== Case 1: valid dataset ===');
const goodReport = checkInstanceIsFunctor(bungaeMartSchema, goodInstance());
console.log(`isFunctor: ${goodReport.isFunctor}  (checked ${goodReport.checkedMorphisms} morphisms, ${goodReport.checkedRows} rows)`);

// ── A broken instance — the two bugs data teams hit constantly ──

function brokenInstance() {
  const b = goodInstance();
  // Bug A: a SKU gets discontinued and removed from the Sku table,
  // but an already-open order still points at it (dangling reference).
  b.rows.Sku = b.rows.Sku.filter((s) => s.id !== 'ramen');
  // ('placedFor' still maps o1002 -> 'ramen', which no longer exists)

  // Bug B: a new SKU is added mid-day but the "which store stocks it"
  // assignment is never written (non-total morphism).
  b.rows.Sku.push({ id: 'salad', name: '샐러드팩', quantity: 5 });
  // (no setFk('stockedAt', 'salad', ...) call — this is the bug)

  return b;
}

console.log('\n=== Case 2: broken dataset (realistic mid-day data drift) ===');
const brokenReport = checkInstanceIsFunctor(bungaeMartSchema, brokenInstance());
console.log(`isFunctor: ${brokenReport.isFunctor}  (${brokenReport.violations.length} violation(s) found)\n`);
for (const v of brokenReport.violations) {
  console.log(`  [${v.reason}] ${v.morphism}: ${v.detail}`);
}
