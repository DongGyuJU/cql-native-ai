// src/__tests__/kanExtensions.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DomainSchema, InstanceBuilder } from '../schema';
import { SchemaMapping } from '../schemaMapping';
import { sigmaF, piF, JoinObjectDef } from '../kanExtensions';

// ── Σ_G: FullTimeEmployee + Contractor -> unified Worker ──────────

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

const G: SchemaMapping = {
  onObjects: { FullTimeEmployee: 'Worker', Contractor: 'Worker', Department: 'Department' },
  onMorphisms: { ftWorksIn: ['worksIn'], contractWorksIn: ['worksIn'] },
};

function narrowInstance() {
  return new InstanceBuilder()
    .addRow('Department', { id: 'eng', name: '개발팀' })
    .addRow('FullTimeEmployee', { id: 'e1', name: '김디케이', salary: 5000 })
    .addRow('FullTimeEmployee', { id: 'e2', name: '이영희', salary: 4800 })
    .addRow('Contractor', { id: 'c1', name: '박계약', hourlyRate: 50 })
    .setFk('ftWorksIn', 'e1', 'eng')
    .setFk('ftWorksIn', 'e2', 'eng')
    .setFk('contractWorksIn', 'c1', 'eng')
    .build();
}

test('sigmaF unions two narrow objects into one broad object (coproduct)', () => {
  const result = sigmaF(G, narrowHrSchema, unifiedSchema, narrowInstance());
  assert.equal(result.rows.Worker.length, 3); // 2 full-time + 1 contractor
  const ids = result.rows.Worker.map((r) => r.id).sort();
  assert.deepEqual(ids, ['Contractor::c1', 'FullTimeEmployee::e1', 'FullTimeEmployee::e2']);
});

test('sigmaF never fabricates a row — every result row traces back to a real source row', () => {
  const src = narrowInstance();
  const result = sigmaF(G, narrowHrSchema, unifiedSchema, src);
  for (const row of result.rows.Worker) {
    const [obj, origId] = row.id.split('::');
    const found = src.rows[obj]?.find((r) => r.id === origId);
    assert.ok(found, `row ${row.id} must trace back to a real source row`);
  }
});

test('sigmaF induces the target morphism fk from both source morphisms directly', () => {
  const result = sigmaF(G, narrowHrSchema, unifiedSchema, narrowInstance());
  assert.equal(result.fk.worksIn['FullTimeEmployee::e1'], 'Department::eng');
  assert.equal(result.fk.worksIn['Contractor::c1'], 'Department::eng');
});

test('sigmaF: an unmapped object contributes nothing (correct empty coproduct)', () => {
  const partialG: SchemaMapping = { onObjects: { FullTimeEmployee: 'Worker', Department: 'Department' }, onMorphisms: { ftWorksIn: ['worksIn'] } };
  const result = sigmaF(partialG, narrowHrSchema, unifiedSchema, narrowInstance());
  // only full-time employees included; contractor rows should NOT appear
  assert.equal(result.rows.Worker.length, 2);
});

// ── Π_G: Person × Book -> Loan (the classic join-as-limit example) ──

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

function catalogInstance(persons: number, books: number) {
  const b = new InstanceBuilder();
  for (let i = 0; i < persons; i++) b.addRow('Person', { id: `p${i}`, name: `Person${i}` });
  for (let i = 0; i < books; i++) b.addRow('Book', { id: `b${i}`, title: `Book${i}` });
  return b.build();
}

test('piF computes the exact Cartesian product cardinality (2 persons x 3 books = 6)', () => {
  const result = piF(libraryG, catalogSchema, libraryViewSchema, catalogInstance(2, 3), loanJoin);
  assert.equal(result.rows.Loan.length, 6);
});

test('piF: an empty factor correctly yields an empty product', () => {
  const result = piF(libraryG, catalogSchema, libraryViewSchema, catalogInstance(0, 3), loanJoin);
  assert.equal(result.rows.Loan.length, 0);
});

test('piF wires projection morphisms so every Loan row recovers its exact source pair', () => {
  const src = catalogInstance(2, 2);
  const result = piF(libraryG, catalogSchema, libraryViewSchema, src, loanJoin);
  assert.equal(result.rows.Loan.length, 4);

  for (const loan of result.rows.Loan) {
    const personId = result.fk.borrower[loan.id];
    const bookId = result.fk.borrowedBook[loan.id];
    assert.ok(src.rows.Person.some((p) => p.id === personId), `borrower ${personId} must be a real Person`);
    assert.ok(src.rows.Book.some((b) => b.id === bookId), `borrowedBook ${bookId} must be a real Book`);
  }

  // every (person, book) pair appears exactly once
  const pairs = new Set(result.rows.Loan.map((l) => `${result.fk.borrower[l.id]}|${result.fk.borrowedBook[l.id]}`));
  assert.equal(pairs.size, 4);
});
