// src/__tests__/attributeMapping.test.ts
//
// Attribute-level mapping (onAttributes). The motivating case is real:
// Ride the Whale's feature pipeline renames earnings columns with a
// hand-written dictionary —
//     col_map = { "earn_accel": "op_accel", "earn_rev_yoy": "rev_yoy", ... }
// — that nothing verifies. A typo there yields a silent column of NaNs,
// not an error. These tests pin down that such a mistake is now caught
// before any data moves.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DomainSchema, InstanceBuilder, checkInstanceIsFunctor } from '../schema';
import { SchemaMapping, checkSchemaMappingLaws, deltaF } from '../schemaMapping';

// The earnings source, with the column names the DART loader actually uses.
const earningsSchema: DomainSchema = {
  objects: {
    EarningsRecord: {
      attributes: [
        { name: 'op_accel', type: 'number' },
        { name: 'op_yoy', type: 'number' },
        { name: 'rev_yoy', type: 'number' },
        { name: 'fiscal_quarter', type: 'string' },
      ],
    },
  },
  morphisms: [],
};

// The panel, with the feature names the model actually trains on.
const panelSchema: DomainSchema = {
  objects: {
    PanelRow: {
      attributes: [
        { name: 'earn_accel', type: 'number' },
        { name: 'earn_yoy', type: 'number' },
        { name: 'earn_rev_yoy', type: 'number' },
      ],
    },
  },
  morphisms: [],
};

const goodF: SchemaMapping = {
  onObjects: { PanelRow: 'EarningsRecord' },
  onMorphisms: {},
  onAttributes: {
    PanelRow: {
      earn_accel: 'op_accel',
      earn_yoy: 'op_yoy',
      earn_rev_yoy: 'rev_yoy',
    },
  },
};

const earningsInstance = new InstanceBuilder()
  .addRow('EarningsRecord', {
    id: 'r1', op_accel: 0.034, op_yoy: 0.12, rev_yoy: 0.08, fiscal_quarter: '2025Q1',
  })
  .addRow('EarningsRecord', {
    id: 'r2', op_accel: -0.011, op_yoy: -0.05, rev_yoy: 0.02, fiscal_quarter: '2025Q1',
  })
  .build();

// ── the happy path ───────────────────────────────────────────────

test('a correct rename table passes the law check', () => {
  const report = checkSchemaMappingLaws(goodF, panelSchema, earningsSchema);
  assert.equal(report.isFunctor, true, JSON.stringify(report.violations));
});

test('deltaF actually performs the rename: op_accel lands as earn_accel', () => {
  const derived = deltaF(goodF, earningsInstance, panelSchema);
  assert.deepEqual(derived.rows.PanelRow, [
    { id: 'r1', earn_accel: 0.034, earn_yoy: 0.12, earn_rev_yoy: 0.08 },
    { id: 'r2', earn_accel: -0.011, earn_yoy: -0.05, earn_rev_yoy: 0.02 },
  ]);
});

test('renaming drops source columns the target never declared (fiscal_quarter)', () => {
  const derived = deltaF(goodF, earningsInstance, panelSchema);
  assert.ok(!('fiscal_quarter' in derived.rows.PanelRow[0]));
  assert.ok(!('op_accel' in derived.rows.PanelRow[0]), 'the old name must not survive');
});

test('capstone: valid mapping + valid instance => the renamed instance is itself valid', () => {
  assert.equal(checkInstanceIsFunctor(earningsSchema, earningsInstance).isFunctor, true);
  const derived = deltaF(goodF, earningsInstance, panelSchema);
  assert.equal(checkInstanceIsFunctor(panelSchema, derived).isFunctor, true);
});

// ── the failures that col_map cannot catch today ─────────────────

test('a TYPO in the rename table is caught before any data moves', () => {
  const typoF: SchemaMapping = {
    ...goodF,
    onAttributes: {
      PanelRow: {
        earn_accel: 'op_accell', // typo: extra 'l' — silently yields NaN in pandas
        earn_yoy: 'op_yoy',
        earn_rev_yoy: 'rev_yoy',
      },
    },
  };
  const report = checkSchemaMappingLaws(typoF, panelSchema, earningsSchema);
  assert.equal(report.isFunctor, false);
  const v = report.violations.find((x) => x.reason === 'unknown-source-attribute');
  assert.ok(v, 'expected unknown-source-attribute');
  assert.match(v!.detail, /op_accell/);
  assert.equal(v!.subject, 'PanelRow.earn_accel');
});

test('a FORGOTTEN feature in the rename table is caught (silent drop becomes an error)', () => {
  const incompleteF: SchemaMapping = {
    ...goodF,
    onAttributes: {
      PanelRow: {
        earn_accel: 'op_accel',
        earn_yoy: 'op_yoy',
        // earn_rev_yoy missing — the t=-7.75 signal would silently vanish
      },
    },
  };
  const report = checkSchemaMappingLaws(incompleteF, panelSchema, earningsSchema);
  assert.equal(report.isFunctor, false);
  const v = report.violations.find((x) => x.reason === 'missing-attribute-mapping');
  assert.ok(v, 'expected missing-attribute-mapping');
  assert.equal(v!.subject, 'PanelRow.earn_rev_yoy');
});

test('a TYPE mismatch in the rename table is caught (number <- string)', () => {
  const wrongTypeF: SchemaMapping = {
    ...goodF,
    onAttributes: {
      PanelRow: {
        earn_accel: 'fiscal_quarter', // string, but earn_accel is number
        earn_yoy: 'op_yoy',
        earn_rev_yoy: 'rev_yoy',
      },
    },
  };
  const report = checkSchemaMappingLaws(wrongTypeF, panelSchema, earningsSchema);
  assert.equal(report.isFunctor, false);
  const v = report.violations.find((x) => x.reason === 'attribute-type-mismatch');
  assert.ok(v, 'expected attribute-type-mismatch');
  assert.match(v!.detail, /number.*string|string.*number/);
});

// ── the implicit identity is checked too ─────────────────────────

test('with NO rename table, a target attribute absent from the source is reported', () => {
  // This is the bug the library silently allowed before this feature:
  // the target wants `earn_accel`, the source has no such column, and
  // nothing complained — deltaF just passed the source rows through.
  const noTableF: SchemaMapping = { onObjects: { PanelRow: 'EarningsRecord' }, onMorphisms: {} };
  const report = checkSchemaMappingLaws(noTableF, panelSchema, earningsSchema);
  assert.equal(report.isFunctor, false);
  const v = report.violations.find((x) => x.reason === 'unknown-source-attribute');
  assert.ok(v, 'expected unknown-source-attribute for the implicit identity');
  assert.match(v!.detail, /declare an explicit onAttributes/);
});

test('with NO rename table, matching names still pass (identity mapping stays valid)', () => {
  const sameNames: DomainSchema = {
    objects: { Mirror: { attributes: [{ name: 'op_accel', type: 'number' }] } },
    morphisms: [],
  };
  const idF: SchemaMapping = { onObjects: { Mirror: 'EarningsRecord' }, onMorphisms: {} };
  const report = checkSchemaMappingLaws(idF, sameNames, earningsSchema);
  assert.equal(report.isFunctor, true, JSON.stringify(report.violations));

  // and deltaF leaves such rows untouched
  const derived = deltaF(idF, earningsInstance, sameNames);
  assert.equal(derived.rows.Mirror[0].op_accel, 0.034);
});
