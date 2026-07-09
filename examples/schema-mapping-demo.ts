// examples/schema-mapping-demo.ts
// Phase B in the scenario that actually matters commercially: two
// departments' systems (HR, Payroll) describing the SAME underlying
// people/org-units through different vocabularies — the textbook
// heterogeneous-schema-integration problem for both government agencies
// and enterprises.
//
// Run: npx ts-node examples/schema-mapping-demo.ts

import { DomainSchema, InstanceBuilder, checkInstanceIsFunctor } from '../src/schema';
import { SchemaMapping, checkSchemaMappingLaws, deltaF, withDerivedAttributes } from '../src/schemaMapping';

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

// F : Payroll → HR — "a Worker IS an Employee, a CostCenter IS a
// Department, billedTo IS worksIn." Declared once. No hand-written
// translateInput() anywhere below.
const F: SchemaMapping = {
  onObjects: { Worker: 'Employee', CostCenter: 'Department' },
  onMorphisms: { billedTo: ['worksIn'] },
};

console.log('=== Step 1: law-check the mapping BEFORE touching any data ===');
const lawReport = checkSchemaMappingLaws(F, payrollSchema, hrSchema);
console.log(`valid mapping: ${lawReport.isFunctor}\n`);

console.log('=== Step 2: a real HR instance ===');
const hrInstance = new InstanceBuilder()
  .addRow('Department', { id: 'eng', name: '개발팀' })
  .addRow('Department', { id: 'sales', name: '영업팀' })
  .addRow('Employee', { id: 'e1', name: '김디케이', salary: 5000 })
  .addRow('Employee', { id: 'e2', name: '이영희', salary: 4800 })
  .setFk('worksIn', 'e1', 'eng')
  .setFk('worksIn', 'e2', 'sales')
  .build();
console.log(`isFunctor(HR instance): ${checkInstanceIsFunctor(hrSchema, hrInstance).isFunctor}\n`);

console.log('=== Step 3: derive the Payroll instance — Δ_F, zero hand-written glue code ===');
const payrollInstance = deltaF(F, hrInstance, payrollSchema);
console.log('Worker rows:', payrollInstance.rows.Worker);
console.log('CostCenter rows:', payrollInstance.rows.CostCenter);
console.log('billedTo map:', payrollInstance.fk.billedTo);
console.log();

console.log('=== Step 4: CAPSTONE — is the derived instance itself a valid functor? ===');
const derivedReport = checkInstanceIsFunctor(payrollSchema, payrollInstance);
console.log(`isFunctor(derived Payroll instance): ${derivedReport.isFunctor}`);
console.log('(guaranteed, not coincidence: valid mapping + valid instance => valid result — functors compose)\n');

console.log('=== Step 5: a BROKEN mapping is caught at design time, before any data flows ===');
const brokenF: SchemaMapping = {
  onObjects: { Worker: 'Employee', CostCenter: 'Team' }, // 'Team' does not exist in hrSchema
  onMorphisms: { billedTo: ['worksIn'] },
};
const brokenLawReport = checkSchemaMappingLaws(brokenF, payrollSchema, hrSchema);
console.log(`valid mapping: ${brokenLawReport.isFunctor}`);
for (const v of brokenLawReport.violations) console.log(`  [${v.reason}] ${v.detail}`);
console.log();

console.log('=== Step 6: where hand-written logic still legitimately lives ===');
console.log('Δ_F cannot invent new values (e.g. annualized cost) — only withDerivedAttributes can:');
const withAnnualized = withDerivedAttributes(payrollInstance, 'Worker', (row) => {
  const employee = hrInstance.rows.Employee.find((e) => e.id === row.id);
  return { annualCost: ((employee?.salary as number) ?? 0) * 12 };
});
console.log(withAnnualized.rows.Worker);
