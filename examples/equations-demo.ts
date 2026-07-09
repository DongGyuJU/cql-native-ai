// examples/equations-demo.ts
// Phase D: schemas WITH path equations. The scenario: Employee's
// department is knowable two ways — via Team (memberOf;partOf), or via
// a cached/denormalized direct field (directDept, common for query
// performance). These two paths are declared equal; when they disagree,
// that's a real, extremely common production bug (someone reassigned an
// employee's team and the cached department field was never refreshed).
//
// Run: npx ts-node examples/equations-demo.ts

import { DomainSchema, InstanceBuilder, checkInstanceIsFunctor } from '../src/schema';

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

console.log('=== Case 1: consistent instance ===\n');
const consistent = new InstanceBuilder()
  .addRow('Department', { id: 'eng', name: '개발본부' })
  .addRow('Team', { id: 'backend', name: '백엔드팀' })
  .addRow('Employee', { id: 'e1', name: '김디케이' })
  .setFk('partOf', 'backend', 'eng')
  .setFk('memberOf', 'e1', 'backend')
  .setFk('directDept', 'e1', 'eng') // agrees with memberOf;partOf
  .build();

const goodReport = checkInstanceIsFunctor(orgSchema, consistent);
console.log(`isFunctor: ${goodReport.isFunctor}  (checked ${goodReport.checkedRows} rows across ${goodReport.checkedMorphisms} morphisms)\n`);

console.log('=== Case 2: 김디케이 was moved to a different team, but the cached ===');
console.log('===          directDept field was never refreshed (real bug) ===\n');
const drifted = new InstanceBuilder()
  .addRow('Department', { id: 'eng', name: '개발본부' })
  .addRow('Department', { id: 'sales', name: '영업본부' })
  .addRow('Team', { id: 'backend', name: '백엔드팀' }) // now under 개발본부
  .addRow('Employee', { id: 'e1', name: '김디케이' })
  .setFk('partOf', 'backend', 'eng')
  .setFk('memberOf', 'e1', 'backend')     // e1 is on the backend team...
  .setFk('directDept', 'e1', 'sales')     // ...but the cached field still says 영업본부 (stale)
  .build();

const badReport = checkInstanceIsFunctor(orgSchema, drifted);
console.log(`isFunctor: ${badReport.isFunctor}\n`);
for (const v of badReport.violations) {
  console.log(`  [${v.reason}] ${v.detail}`);
}

console.log('\n=== What makes this different from a Phase A dangling-reference bug ===');
console.log('Both directDept="sales" and the memberOf/partOf chain point at');
console.log('rows that genuinely EXIST — nothing is dangling, nothing is missing.');
console.log('The bug only exists in the RELATIONSHIP between two independently');
console.log('valid facts. Phase A alone (referential integrity) cannot see this;');
console.log('it takes a declared equation to make it checkable at all.');
