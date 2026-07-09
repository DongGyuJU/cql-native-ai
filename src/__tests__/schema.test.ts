// src/__tests__/schema.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DomainSchema,
  InstanceBuilder,
  checkInstanceIsFunctor,
  describeSchema,
  describeMorphisms,
} from '../schema';

const storeSchema: DomainSchema = {
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

function validInstance() {
  return new InstanceBuilder()
    .addRow('Store', { id: 'seongsu', name: '성수점' })
    .addRow('Sku', { id: 'water', name: '생수 2L', quantity: 25 })
    .addRow('Sku', { id: 'ramen', name: '컵라면', quantity: 12 })
    .addRow('Order', { id: 'o1', placedAt: '2026-07-09' })
    .setFk('stockedAt', 'water', 'seongsu')
    .setFk('stockedAt', 'ramen', 'seongsu')
    .setFk('placedFor', 'o1', 'water')
    .build();
}

test('checkInstanceIsFunctor accepts a fully valid instance', () => {
  const report = checkInstanceIsFunctor(storeSchema, validInstance());
  assert.equal(report.isFunctor, true);
  assert.equal(report.violations.length, 0);
  assert.equal(report.checkedMorphisms, 2);
  assert.equal(report.checkedRows, 3); // 2 Sku rows (stockedAt) + 1 Order row (placedFor)
});

test('checkInstanceIsFunctor catches a dangling reference (orphaned foreign key)', () => {
  const inst = new InstanceBuilder()
    .addRow('Store', { id: 'seongsu', name: '성수점' })
    .addRow('Sku', { id: 'water', name: '생수 2L', quantity: 25 })
    .addRow('Order', { id: 'o1', placedAt: '2026-07-09' })
    .setFk('stockedAt', 'water', 'seongsu')
    .setFk('placedFor', 'o1', 'discontinued-sku') // <- points at a Sku that doesn't exist
    .build();

  const report = checkInstanceIsFunctor(storeSchema, inst);
  assert.equal(report.isFunctor, false);
  assert.equal(report.violations.length, 1);
  const v = report.violations[0];
  assert.equal(v.reason, 'dangling-reference');
  assert.equal(v.morphism, 'placedFor');
  assert.equal(v.rowId, 'o1');
  assert.match(v.detail, /discontinued-sku/);
});

test('checkInstanceIsFunctor catches a non-total morphism (missing fk entry)', () => {
  const inst = new InstanceBuilder()
    .addRow('Store', { id: 'seongsu', name: '성수점' })
    .addRow('Sku', { id: 'water', name: '생수 2L', quantity: 25 })
    .addRow('Sku', { id: 'ramen', name: '컵라면', quantity: 12 }) // <- never gets a stockedAt entry
    .setFk('stockedAt', 'water', 'seongsu')
    .build();

  const report = checkInstanceIsFunctor(storeSchema, inst);
  assert.equal(report.isFunctor, false);
  const v = report.violations.find((x) => x.rowId === 'ramen');
  assert.ok(v);
  assert.equal(v!.reason, 'not-total');
});

test('checkInstanceIsFunctor reports unknown-source-object / unknown-target-object when an object has no rows at all', () => {
  const inst = new InstanceBuilder()
    .addRow('Sku', { id: 'water', name: '생수 2L', quantity: 25 })
    .setFk('stockedAt', 'water', 'seongsu')
    .build();
  // no Store rows registered at all

  const report = checkInstanceIsFunctor(storeSchema, inst);
  assert.equal(report.isFunctor, false);
  assert.ok(report.violations.some((v) => v.reason === 'unknown-target-object' && v.morphism === 'stockedAt'));
});

test('multiple violations across different morphisms are all reported, not just the first', () => {
  const inst = new InstanceBuilder()
    .addRow('Sku', { id: 'water', name: '생수 2L', quantity: 25 })
    .addRow('Order', { id: 'o1', placedAt: '2026-07-09' })
    // both stockedAt (Sku->Store) and placedFor (Order->Sku) left totally unmapped,
    // AND Store has no rows at all
    .build();

  const report = checkInstanceIsFunctor(storeSchema, inst);
  assert.equal(report.isFunctor, false);
  assert.ok(report.violations.length >= 2);
});

test('InstanceBuilder.addRows adds multiple rows at once', () => {
  const inst = new InstanceBuilder()
    .addRows('Store', [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
    .build();
  assert.equal(inst.rows.Store.length, 2);
});

test('describeSchema derives human-readable field descriptions from typed attributes', () => {
  const desc = describeSchema(storeSchema);
  assert.equal(desc.Store, 'name: string');
  assert.equal(desc.Sku, 'name: string, quantity: number');
});

test('describeMorphisms derives DomainRelation-shaped entries from typed morphisms', () => {
  const rels = describeMorphisms(storeSchema);
  assert.deepEqual(rels, [
    { from: 'Sku', to: 'Store', label: 'stockedAt' },
    { from: 'Order', to: 'Sku', label: 'placedFor' },
  ]);
});
