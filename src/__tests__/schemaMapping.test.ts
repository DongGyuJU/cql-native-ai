// src/__tests__/schemaMapping.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DomainSchema, InstanceBuilder, checkInstanceIsFunctor } from '../schema';
import { SchemaMapping, checkSchemaMappingLaws, deltaF, withDerivedAttributes } from '../schemaMapping';

const hrSchema: DomainSchema = {
  objects: {
    Employee: { attributes: [{ name: 'name', type: 'string' }, { name: 'salary', type: 'number' }] },
    Department: { attributes: [{ name: 'name', type: 'string' }] },
  },
  morphisms: [{ name: 'worksIn', from: 'Employee', to: 'Department' }],
};

const payrollSchema: DomainSchema = {
  objects: {
    Worker: { attributes: [{ name: 'name', type: 'string' }] },
    CostCenter: { attributes: [{ name: 'name', type: 'string' }] },
  },
  morphisms: [{ name: 'billedTo', from: 'Worker', to: 'CostCenter' }],
};

const validF: SchemaMapping = {
  onObjects: { Worker: 'Employee', CostCenter: 'Department' },
  onMorphisms: { billedTo: ['worksIn'] },
};

function validHrInstance() {
  return new InstanceBuilder()
    .addRow('Department', { id: 'eng', name: '개발팀' })
    .addRow('Department', { id: 'sales', name: '영업팀' })
    .addRow('Employee', { id: 'e1', name: '김디케이', salary: 5000 })
    .addRow('Employee', { id: 'e2', name: '이영희', salary: 4800 })
    .setFk('worksIn', 'e1', 'eng')
    .setFk('worksIn', 'e2', 'sales')
    .build();
}

test('checkSchemaMappingLaws accepts a well-typed mapping', () => {
  const report = checkSchemaMappingLaws(validF, payrollSchema, hrSchema);
  assert.equal(report.isFunctor, true);
  assert.equal(report.violations.length, 0);
});

test('checkSchemaMappingLaws catches onObjects pointing to a nonexistent source object', () => {
  const badF: SchemaMapping = {
    onObjects: { Worker: 'Employee', CostCenter: 'Team' }, // 'Team' doesn't exist in hrSchema
    onMorphisms: { billedTo: ['worksIn'] },
  };
  const report = checkSchemaMappingLaws(badF, payrollSchema, hrSchema);
  assert.equal(report.isFunctor, false);
  assert.ok(report.violations.some((v) => v.reason === 'unknown-source-object' && v.subject === 'CostCenter'));
});

test('checkSchemaMappingLaws catches a path whose endpoints do not match F applied to the morphism endpoints', () => {
  // deliberately map billedTo to the identity even though Worker != CostCenter under F
  const badF: SchemaMapping = {
    onObjects: { Worker: 'Employee', CostCenter: 'Department' },
    onMorphisms: { billedTo: [] }, // identity path, but F(Worker)=Employee != F(CostCenter)=Department
  };
  const report = checkSchemaMappingLaws(badF, payrollSchema, hrSchema);
  assert.equal(report.isFunctor, false);
  assert.ok(report.violations.some((v) => v.reason === 'identity-endpoint-mismatch'));
});

test('checkSchemaMappingLaws catches an unknown morphism name inside a path', () => {
  const badF: SchemaMapping = {
    onObjects: { Worker: 'Employee', CostCenter: 'Department' },
    onMorphisms: { billedTo: ['doesNotExist'] },
  };
  const report = checkSchemaMappingLaws(badF, payrollSchema, hrSchema);
  assert.equal(report.isFunctor, false);
  assert.ok(report.violations.some((v) => v.reason === 'unknown-morphism-in-path'));
});

test('deltaF produces target-shaped data with zero hand-written translation code', () => {
  const hrInstance = validHrInstance();
  const payrollInstance = deltaF(validF, hrInstance, payrollSchema);

  assert.deepEqual(payrollInstance.rows.Worker.map((r) => r.id).sort(), ['e1', 'e2']);
  assert.deepEqual(payrollInstance.rows.CostCenter.map((r) => r.id).sort(), ['eng', 'sales']);
  assert.equal(payrollInstance.fk.billedTo.e1, 'eng');
  assert.equal(payrollInstance.fk.billedTo.e2, 'sales');
});

test('CAPSTONE: a valid mapping applied to a valid instance always yields a valid instance (functors compose)', () => {
  const hrInstance = validHrInstance();
  assert.equal(checkInstanceIsFunctor(hrSchema, hrInstance).isFunctor, true);
  assert.equal(checkSchemaMappingLaws(validF, payrollSchema, hrSchema).isFunctor, true);

  const derived = deltaF(validF, hrInstance, payrollSchema);
  const derivedReport = checkInstanceIsFunctor(payrollSchema, derived);
  assert.equal(derivedReport.isFunctor, true, 'derived instance must itself be a valid functor');
});

test('a non-total source instance propagates honestly into a non-total derived instance', () => {
  const brokenHr = new InstanceBuilder()
    .addRow('Department', { id: 'eng', name: '개발팀' })
    .addRow('Employee', { id: 'e1', name: '김디케이', salary: 5000 })
    .addRow('Employee', { id: 'e2', name: '이영희', salary: 4800 })
    .setFk('worksIn', 'e1', 'eng')
    // e2 never gets a worksIn entry — source itself is broken
    .build();

  assert.equal(checkInstanceIsFunctor(hrSchema, brokenHr).isFunctor, false);

  const derived = deltaF(validF, brokenHr, payrollSchema);
  const derivedReport = checkInstanceIsFunctor(payrollSchema, derived);
  assert.equal(derivedReport.isFunctor, false);
  assert.ok(derivedReport.violations.some((v) => v.rowId === 'e2' && v.reason === 'not-total'));
});

test('withDerivedAttributes attaches computed values without touching row identity/mapping', () => {
  const hrInstance = validHrInstance();
  const payrollInstance = deltaF(validF, hrInstance, payrollSchema);

  const withAnnualized = withDerivedAttributes(payrollInstance, 'Worker', (row) => {
    const employee = hrInstance.rows.Employee.find((e) => e.id === row.id);
    return { annualCost: ((employee?.salary as number) ?? 0) * 12 };
  });

  const e1 = withAnnualized.rows.Worker.find((r) => r.id === 'e1');
  assert.equal(e1?.annualCost, 60000);
  // structural mapping (fk) is untouched by this step
  assert.equal(withAnnualized.fk.billedTo.e1, 'eng');
});
