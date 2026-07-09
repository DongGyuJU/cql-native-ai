// examples/kan-extensions-demo.ts
// Phase C: Σ_G (union of heterogeneous sub-schemas) and Π_G (join as a
// limit) — the two most commercially relevant patterns for government/
// enterprise data integration, each in its natural scenario.
//
// Run: npx ts-node examples/kan-extensions-demo.ts

import { DomainSchema, InstanceBuilder } from '../src/schema';
import { SchemaMapping } from '../src/schemaMapping';
import { sigmaF, piF, JoinObjectDef } from '../src/kanExtensions';

// ════════════════════════════════════════════════════════════════
// Σ_G — merging two departments' heterogeneous HR systems
// ════════════════════════════════════════════════════════════════

console.log('════════════════════════════════════════════════════');
console.log('Σ_G — 정규직 시스템 + 계약직 시스템 → 통합 인력 뷰');
console.log('════════════════════════════════════════════════════\n');

const narrowHrSchema: DomainSchema = {
  objects: {
    FullTimeEmployee: { attributes: [{ name: 'name', type: 'string' }, { name: 'salary', type: 'number' }] },
    Contractor: { attributes: [{ name: 'name', type: 'string' }, { name: 'hourlyRate', type: 'number' }] },
    Department: { attributes: [{ name: 'name', type: 'string' }] },
  },
  morphisms: [
    { name: 'ftWorksIn', from: 'FullTimeEmployee', to: 'Department' },
    { name: 'contractWorksIn', from: 'Contractor', to: 'Department' },
  ],
};

const unifiedSchema: DomainSchema = {
  objects: {
    Worker: { attributes: [{ name: 'name', type: 'string' }] },
    Department: { attributes: [{ name: 'name', type: 'string' }] },
  },
  morphisms: [{ name: 'worksIn', from: 'Worker', to: 'Department' }],
};

// G : narrow -> unified — "both kinds of worker become one Worker"
const G: SchemaMapping = {
  onObjects: { FullTimeEmployee: 'Worker', Contractor: 'Worker', Department: 'Department' },
  onMorphisms: { ftWorksIn: ['worksIn'], contractWorksIn: ['worksIn'] },
};

const narrowInstance = new InstanceBuilder()
  .addRow('Department', { id: 'eng', name: '개발팀' })
  .addRow('FullTimeEmployee', { id: 'e1', name: '김디케이', salary: 5000 })
  .addRow('FullTimeEmployee', { id: 'e2', name: '이영희', salary: 4800 })
  .addRow('Contractor', { id: 'c1', name: '박계약', hourlyRate: 50 })
  .setFk('ftWorksIn', 'e1', 'eng')
  .setFk('ftWorksIn', 'e2', 'eng')
  .setFk('contractWorksIn', 'c1', 'eng')
  .build();

console.log('narrow schema (2 separate object types, each with its own attributes):');
console.log(`  FullTimeEmployee: ${narrowInstance.rows.FullTimeEmployee.length} rows`);
console.log(`  Contractor:       ${narrowInstance.rows.Contractor.length} rows`);

const unifiedInstance = sigmaF(G, narrowHrSchema, unifiedSchema, narrowInstance);
console.log('\nΣ_G output — one unified Worker object, zero hand-written merge code:');
console.log(unifiedInstance.rows.Worker);
console.log('\nworksIn fk (both source morphisms collapsed onto one target morphism):');
console.log(unifiedInstance.fk.worksIn);

// ════════════════════════════════════════════════════════════════
// Π_G — the classic join-as-a-limit example
// ════════════════════════════════════════════════════════════════

console.log('\n\n════════════════════════════════════════════════════');
console.log('Π_G — Person × Book → Loan (join as a limit)');
console.log('════════════════════════════════════════════════════\n');

const catalogSchema: DomainSchema = {
  objects: {
    Person: { attributes: [{ name: 'name', type: 'string' }] },
    Book: { attributes: [{ name: 'title', type: 'string' }] },
  },
  morphisms: [],
};

const libraryViewSchema: DomainSchema = {
  objects: {
    Person: { attributes: [{ name: 'name', type: 'string' }] },
    Book: { attributes: [{ name: 'title', type: 'string' }] },
    Loan: { attributes: [] },
  },
  morphisms: [
    { name: 'borrower', from: 'Loan', to: 'Person' },
    { name: 'borrowedBook', from: 'Loan', to: 'Book' },
  ],
};

const libraryG: SchemaMapping = { onObjects: { Person: 'Person', Book: 'Book' }, onMorphisms: {} };
const loanJoin: JoinObjectDef = { name: 'Loan', projections: ['borrower', 'borrowedBook'] };

const catalog = new InstanceBuilder()
  .addRow('Person', { id: 'p1', name: '김디케이' })
  .addRow('Person', { id: 'p2', name: '이영희' })
  .addRow('Book', { id: 'b1', title: 'Category Theory for Programmers' })
  .addRow('Book', { id: 'b2', title: 'Functorial Data Migration' })
  .addRow('Book', { id: 'b3', title: 'Seven Sketches in Compositionality' })
  .build();

console.log(`Person rows: ${catalog.rows.Person.length}, Book rows: ${catalog.rows.Book.length}`);
console.log(`expected |Loan| = ${catalog.rows.Person.length} × ${catalog.rows.Book.length} = ${catalog.rows.Person.length * catalog.rows.Book.length}\n`);

const libraryInstance = piF(libraryG, catalogSchema, libraryViewSchema, catalog, loanJoin);
console.log(`Π_G output — actual |Loan| = ${libraryInstance.rows.Loan.length}\n`);

console.log('first 4 Loan rows resolved back to (Person, Book) pairs:');
for (const loan of libraryInstance.rows.Loan.slice(0, 4)) {
  const personId = libraryInstance.fk.borrower[loan.id];
  const bookId = libraryInstance.fk.borrowedBook[loan.id];
  const person = catalog.rows.Person.find((p) => p.id === personId);
  const book = catalog.rows.Book.find((b) => b.id === bookId);
  console.log(`  ${loan.id}  →  ${person?.name} borrows "${book?.title}"`);
}
