// src/__tests__/equations.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DomainSchema, InstanceBuilder, checkInstanceIsFunctor, pathsAreDeclaredEqual } from '../schema';
import { SchemaMapping, checkSchemaMappingLaws } from '../schemaMapping';

// Employee -> Team -> Department must agree with Employee -> Department
// (a denormalized/cached direct pointer) — the single most common real
// data-drift bug: someone changes a team assignment and the cached
// "current department" field never gets updated.
const orgSchema: DomainSchema = {
  objects: {
    Employee: { attributes: [{ name: 'name', type: 'string' }] },
    Team: { attributes: [{ name: 'name', type: 'string' }] },
    Department: { attributes: [{ name: 'name', type: 'string' }] },
  },
  morphisms: [
    { name: 'memberOf', from: 'Employee', to: 'Team' },
    { name: 'partOf', from: 'Team', to: 'Department' },
    { name: 'directDept', from: 'Employee', to: 'Department' },
  ],
  equations: [
    { name: 'memberOf;partOf = directDept', from: 'Employee', left: ['memberOf', 'partOf'], right: ['directDept'] },
  ],
};

test('checkInstanceIsFunctor accepts an instance where the equation holds', () => {
  const inst = new InstanceBuilder()
    .addRow('Department', { id: 'eng', name: '개발본부' })
    .addRow('Team', { id: 'backend', name: '백엔드팀' })
    .addRow('Employee', { id: 'e1', name: '김디케이' })
    .setFk('partOf', 'backend', 'eng')
    .setFk('memberOf', 'e1', 'backend')
    .setFk('directDept', 'e1', 'eng')
    .build();

  const report = checkInstanceIsFunctor(orgSchema, inst);
  assert.equal(report.isFunctor, true);
});

test('checkInstanceIsFunctor catches an equation violation (denormalization drift)', () => {
  const inst = new InstanceBuilder()
    .addRow('Department', { id: 'eng', name: '개발본부' })
    .addRow('Department', { id: 'sales', name: '영업본부' })
    .addRow('Team', { id: 'backend', name: '백엔드팀' })
    .addRow('Employee', { id: 'e1', name: '김디케이' })
    .setFk('partOf', 'backend', 'eng')
    .setFk('memberOf', 'e1', 'backend')
    .setFk('directDept', 'e1', 'sales') // stale — employee's team says eng, cached field says sales
    .build();

  const report = checkInstanceIsFunctor(orgSchema, inst);
  assert.equal(report.isFunctor, false);
  const v = report.violations.find((v) => v.reason === 'equation-violated');
  assert.ok(v);
  assert.equal(v!.rowId, 'e1');
  assert.match(v!.detail, /"eng"/);
  assert.match(v!.detail, /"sales"/);
});

test('checkInstanceIsFunctor does not double-report when the underlying path is already non-total', () => {
  const inst = new InstanceBuilder()
    .addRow('Department', { id: 'eng', name: '개발본부' })
    .addRow('Team', { id: 'backend', name: '백엔드팀' })
    .addRow('Employee', { id: 'e1', name: '김디케이' })
    .setFk('partOf', 'backend', 'eng')
    // memberOf never set for e1 — a plain totality bug, not an equation bug
    .setFk('directDept', 'e1', 'eng')
    .build();

  const report = checkInstanceIsFunctor(orgSchema, inst);
  assert.equal(report.isFunctor, false);
  assert.ok(report.violations.some((v) => v.reason === 'not-total'));
  assert.equal(report.violations.some((v) => v.reason === 'equation-violated'), false);
});

test('pathsAreDeclaredEqual: syntactically identical paths are always equal', () => {
  assert.equal(pathsAreDeclaredEqual(orgSchema, 'Employee', ['memberOf'], ['memberOf']), true);
});

test('pathsAreDeclaredEqual: an undeclared pair of different paths is NOT considered equal (no closure)', () => {
  // even though both are length-1 no-op-looking comparisons, nothing declares this equal
  assert.equal(pathsAreDeclaredEqual(orgSchema, 'Employee', ['memberOf'], ['directDept']), false);
});

test('pathsAreDeclaredEqual: declared equation recognized in either orientation', () => {
  assert.equal(pathsAreDeclaredEqual(orgSchema, 'Employee', ['memberOf', 'partOf'], ['directDept']), true);
  assert.equal(pathsAreDeclaredEqual(orgSchema, 'Employee', ['directDept'], ['memberOf', 'partOf']), true);
});

// ── SchemaMapping respecting equations ──────────────────────────

const flatOrgSchema: DomainSchema = {
  objects: {
    Person: { attributes: [{ name: 'name', type: 'string' }] },
    Group: { attributes: [{ name: 'name', type: 'string' }] },
  },
  morphisms: [{ name: 'belongsTo', from: 'Person', to: 'Group' }],
};

test('checkSchemaMappingLaws accepts a mapping that respects the target equation', () => {
  // both memberOf;partOf and directDept get sent to the SAME source path
  // ("belongsTo") — trivially respects the equation (identical images)
  const F: SchemaMapping = {
    onObjects: { Employee: 'Person', Team: 'Group', Department: 'Group' },
    onMorphisms: { memberOf: ['belongsTo'], partOf: [], directDept: ['belongsTo'] },
  };
  const report = checkSchemaMappingLaws(F, orgSchema, flatOrgSchema);
  assert.equal(report.violations.some((v) => v.reason === 'equation-not-respected'), false);
});

test('checkSchemaMappingLaws catches a mapping that breaks the target equation', () => {
  // Team and Department mapped to DIFFERENT unrelated Group-ish targets
  // with no declared equality between the two induced source paths
  const brokenFlatSchema: DomainSchema = {
    objects: {
      Person: { attributes: [{ name: 'name', type: 'string' }] },
      GroupA: { attributes: [{ name: 'name', type: 'string' }] },
      GroupB: { attributes: [{ name: 'name', type: 'string' }] },
    },
    morphisms: [
      { name: 'inA', from: 'Person', to: 'GroupA' },
      { name: 'inB', from: 'Person', to: 'GroupB' },
    ],
  };
  const F: SchemaMapping = {
    onObjects: { Employee: 'Person', Team: 'GroupA', Department: 'GroupB' },
    onMorphisms: { memberOf: ['inA'], partOf: [], directDept: ['inB'] },
  };
  // note: partOf: [] (identity) is invalid here too (Team != Department under F),
  // but we're specifically checking the equation violation is ALSO reported
  const report = checkSchemaMappingLaws(F, orgSchema, brokenFlatSchema);
  assert.ok(report.violations.some((v) => v.reason === 'equation-not-respected'));
});
