// src/kanExtensions.ts
// Phase C: Σ_G and Π_G, the left/right Kan extensions along a
// SchemaMapping G : A → B (same type as Phase B's SchemaMapping —
// reused as-is; checkSchemaMappingLaws already validates it correctly
// regardless of which of Δ/Σ/Π it will drive).
//
// HONEST SCOPE — read before using: the fully general Σ_F/Π_F are
// colimits/limits over a comma category, which (even for finite,
// equation-free schemas) requires enumerating every path in B and
// solving a quotient/equalizer problem. That general construction is
// NOT implemented here. Instead:
//
//   sigmaF()  implements the UNION/COPRODUCT case: several A-Objects
//             collapsing into one B-Object (e.g. "FullTimeEmployee"
//             and "Contractor" both becoming "Worker"), with morphism
//             correspondences restricted to direct, length-1 mappings
//             (G.onMorphisms[name] = [oneMorphism], no composite paths).
//
//   piF()     implements the JOIN/PRODUCT case: a new B-Object with
//             outgoing "projection" morphisms into two or more
//             already-included B-Objects (the textbook SQL-join-as-
//             a-limit example). It assumes G is object-injective on
//             the objects being joined (at most one A-Object maps to
//             each of those B-Objects).
//
// Both are correct and useful within this scope, and both scopes cover
// the two most commercially relevant integration patterns (merging
// heterogeneous sub-schemas; joining independent datasets) without
// requiring general path search. Arbitrary multi-step gluing remains
// future work.

import { DomainSchema, Instance, Row } from './schema';
import { SchemaMapping } from './schemaMapping';

function tag(object: string, id: string): string {
  return `${object}::${id}`;
}

// ════════════════════════════════════════════════════════════════
// Σ_G — union / coproduct migration
// ════════════════════════════════════════════════════════════════

/**
 * Σ_G(instanceOnA) : an Instance on schemaB, where every B-Object's rows
 * are the disjoint union of all A-Objects that G maps onto it (row ids
 * are namespaced as "AObject::originalId" to guarantee no collisions
 * when multiple A-Objects fold together), and every B-Morphism's fk is
 * induced from whichever A-Morphisms G maps directly onto it.
 *
 * No row is ever fabricated — every row in the result can be traced
 * back to exactly one row of `instanceOnA` by stripping its tag prefix.
 */
export function sigmaF(
  G: SchemaMapping,
  schemaA: DomainSchema,
  schemaB: DomainSchema,
  instanceOnA: Instance,
): Instance {
  const rows: Record<string, Row[]> = {};
  for (const bObj of Object.keys(schemaB.objects)) rows[bObj] = [];

  for (const [aObj, bObj] of Object.entries(G.onObjects)) {
    if (!rows[bObj]) rows[bObj] = [];
    for (const r of instanceOnA.rows[aObj] ?? []) {
      rows[bObj].push({ ...r, id: tag(aObj, r.id) });
    }
  }

  const fk: Record<string, Record<string, string>> = {};
  for (const bm of schemaB.morphisms) fk[bm.name] = {};

  for (const am of schemaA.morphisms) {
    const path = G.onMorphisms[am.name];
    if (!path || path.length !== 1) continue; // out of scope: composite paths
    const bmName = path[0];
    if (!(bmName in fk)) continue; // not a real target morphism

    for (const row of instanceOnA.rows[am.from] ?? []) {
      const targetId = instanceOnA.fk[am.name]?.[row.id];
      if (targetId === undefined) continue; // source itself non-total: propagate honestly by omitting
      fk[bmName][tag(am.from, row.id)] = tag(am.to, targetId);
    }
  }

  return { rows, fk };
}

// ════════════════════════════════════════════════════════════════
// Π_G — join / product migration
// ════════════════════════════════════════════════════════════════

export interface JoinObjectDef {
  /** name of the new B-Object being computed as a limit (e.g. "Loan") */
  name: string;
  /**
   * names of B-Morphisms whose `from` is this join object and whose
   * `to` is an already-included B-Object (e.g. ["borrower", "borrowedBook"]).
   * Π computes the Cartesian product over exactly these factors.
   */
  projections: string[];
}

/**
 * Π_G(instanceOnA) : an Instance on schemaB that (a) carries every
 * G-included object over as-is (assumes G is object-injective on these
 * — at most one A-Object maps to each), and (b) computes `joinObject`
 * as the literal Cartesian product of its projection targets' rows,
 * with each projection morphism wired to the correct factor.
 *
 * This is the textbook "natural join as a limit" construction: with
 * two projections, |joinObject rows| = |factor1 rows| × |factor2 rows|,
 * exactly matching a plain SQL cross join (no further equality
 * constraints are imposed here — that would require an equalizer on
 * top of this product, which is out of scope).
 */
export function piF(
  G: SchemaMapping,
  schemaA: DomainSchema,
  schemaB: DomainSchema,
  instanceOnA: Instance,
  joinObject: JoinObjectDef,
): Instance {
  const rows: Record<string, Row[]> = {};
  for (const bObj of Object.keys(schemaB.objects)) rows[bObj] = [];

  for (const [aObj, bObj] of Object.entries(G.onObjects)) {
    rows[bObj] = (instanceOnA.rows[aObj] ?? []).map((r) => ({ ...r }));
  }

  const factors = joinObject.projections.map((projName) => {
    const proj = schemaB.morphisms.find((m) => m.name === projName);
    if (!proj) throw new Error(`piF: unknown projection morphism "${projName}"`);
    return { projName, rows: rows[proj.to] ?? [] };
  });

  const productRows: Row[] = [];
  const perRowProjections: Record<string, Record<string, string>> = {};

  function cartesian(idx: number, chosenIds: string[]) {
    if (idx === factors.length) {
      const id = chosenIds.join('×');
      productRows.push({ id });
      perRowProjections[id] = {};
      factors.forEach((f, i) => { perRowProjections[id][f.projName] = chosenIds[i]; });
      return;
    }
    for (const r of factors[idx].rows) cartesian(idx + 1, [...chosenIds, r.id]);
  }
  if (factors.every((f) => f.rows.length > 0)) cartesian(0, []);
  // if any factor is empty, the product is correctly empty — cartesian() simply isn't called

  rows[joinObject.name] = productRows;

  const fk: Record<string, Record<string, string>> = {};
  for (const bm of schemaB.morphisms) fk[bm.name] = {};
  for (const [rowId, proj] of Object.entries(perRowProjections)) {
    for (const [projName, targetId] of Object.entries(proj)) {
      fk[projName][rowId] = targetId;
    }
  }

  return { rows, fk };
}
