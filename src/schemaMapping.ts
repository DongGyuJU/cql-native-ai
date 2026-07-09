// src/schemaMapping.ts
// Phase B: a SchemaMapping is an actual Functor F : TargetSchema → SourceSchema
// between two DomainSchema Categories (see ./schema for DomainSchema/Instance).
//
// Convention (read this before using anything below): F points FROM the
// schema whose SHAPE you want your output to have, INTO the schema whose
// DATA you already have. This is deliberately the reverse of what feels
// natural at first ("shouldn't F go source -> target?") — it's what makes
// Δ_F(sourceInstance) correctly produce target-shaped data. See Spivak,
// "Functorial Data Migration": for F : C → D, Δ_F(I) = I ∘ F sends a
// D-instance to a C-instance. Here "D" = your existing data's schema,
// "C" = the schema you want to view it through.
//
// checkSchemaMappingLaws() verifies F is well-typed BEFORE you touch any
// data — every target Object must land on a real source Object, and every
// target Morphism must land on a source Morphism PATH whose endpoints
// actually match. This catches integration bugs at design time.
//
// deltaF() then performs the actual pullback: target rows are literally
// the corresponding source rows (relabeled, not copied-and-transformed),
// and target morphisms are computed by walking the declared source path.
//
// HONEST SCOPE: Δ_F only reindexes existing structure. It cannot invent
// new attribute values (e.g. a derived "surge ratio" computed from two
// source fields) — that is not a structural/categorical operation. See
// `withDerivedAttributes` at the bottom for where hand-written business
// logic still legitimately belongs, now scoped to per-row attribute
// computation instead of an opaque whole-object translation function.

import { DomainSchema, Instance, Row, resolvePathEndpoints, pathsAreDeclaredEqual } from './schema';

/** F : TargetSchema → SourceSchema */
export interface SchemaMapping {
  /** target Object name -> source Object name */
  onObjects: Record<string, string>;
  /**
   * target Morphism name -> a PATH of source Morphism names, applied in
   * left-to-right (diagrammatic) order: ['a','b'] means "walk a, then walk b".
   * An empty array [] means "this target morphism maps to the identity" —
   * only valid when the target morphism's endpoints map to the SAME source object.
   */
  onMorphisms: Record<string, string[]>;
}

export type SchemaMappingViolationReason =
  | 'missing-object-mapping'
  | 'unknown-source-object'
  | 'missing-morphism-mapping'
  | 'unknown-morphism-in-path'
  | 'disconnected-path'
  | 'identity-endpoint-mismatch'
  | 'path-endpoint-mismatch'
  | 'equation-not-respected';

export interface SchemaMappingViolation {
  reason: SchemaMappingViolationReason;
  subject: string; // the target object or morphism name this violation is about
  detail: string;
}

export interface SchemaMappingCheckReport {
  isFunctor: boolean;
  violations: SchemaMappingViolation[];
}

// resolvePathEndpoints is imported from ./schema — shared with checkInstanceIsFunctor's equation checking.

/**
 * Verifies F : targetSchema → sourceSchema is well-typed: every target
 * Object maps to a real source Object, and every target Morphism maps to
 * a source path whose endpoints match F applied to that morphism's own
 * endpoints. This is exactly the Functor law for a mapping between two
 * (free) categories — checkable in full because both schemas are finite.
 */
export function checkSchemaMappingLaws(
  F: SchemaMapping,
  targetSchema: DomainSchema,
  sourceSchema: DomainSchema,
): SchemaMappingCheckReport {
  const violations: SchemaMappingViolation[] = [];

  for (const objName of Object.keys(targetSchema.objects)) {
    const mapped = F.onObjects[objName];
    if (mapped === undefined) {
      violations.push({
        reason: 'missing-object-mapping', subject: objName,
        detail: `target object "${objName}" has no entry in onObjects`,
      });
      continue;
    }
    if (!sourceSchema.objects[mapped]) {
      violations.push({
        reason: 'unknown-source-object', subject: objName,
        detail: `onObjects["${objName}"] = "${mapped}", which does not exist in the source schema`,
      });
    }
  }

  for (const m of targetSchema.morphisms) {
    const path = F.onMorphisms[m.name];
    if (path === undefined) {
      violations.push({
        reason: 'missing-morphism-mapping', subject: m.name,
        detail: `target morphism "${m.name}" has no entry in onMorphisms`,
      });
      continue;
    }

    const expectedFrom = F.onObjects[m.from];
    const expectedTo = F.onObjects[m.to];

    if (path.length === 0) {
      if (expectedFrom !== expectedTo) {
        violations.push({
          reason: 'identity-endpoint-mismatch', subject: m.name,
          detail: `"${m.name}" maps to the identity path, but F(${m.from})="${expectedFrom}" != F(${m.to})="${expectedTo}" — an identity morphism must start and end on the same source object`,
        });
      }
      continue;
    }

    const endpoints = resolvePathEndpoints(sourceSchema, path);
    if (endpoints === 'unknown-morphism') {
      violations.push({
        reason: 'unknown-morphism-in-path', subject: m.name,
        detail: `"${m.name}"'s path [${path.join(', ')}] references a morphism name that doesn't exist in the source schema`,
      });
    } else if (endpoints === 'disconnected') {
      violations.push({
        reason: 'disconnected-path', subject: m.name,
        detail: `"${m.name}"'s path [${path.join(', ')}] doesn't chain together (each step's target must equal the next step's source)`,
      });
    } else if (endpoints.from !== expectedFrom || endpoints.to !== expectedTo) {
      violations.push({
        reason: 'path-endpoint-mismatch', subject: m.name,
        detail: `"${m.name}": F(${m.from})="${expectedFrom}" and F(${m.to})="${expectedTo}", but the declared path [${path.join(', ')}] actually goes from "${endpoints.from}" to "${endpoints.to}"`,
      });
    }
  }

  // F must send declared-equal paths to declared-equal paths — the
  // functor law extended to equations. We only need to check paths
  // that are actually named in targetSchema.equations; each morphism
  // used inside them was already validated above.
  for (const eq of targetSchema.equations ?? []) {
    const mappedFrom = F.onObjects[eq.from];
    if (mappedFrom === undefined) continue; // already reported as missing-object-mapping

    const buildSourcePath = (path: string[]): string[] | null => {
      const out: string[] = [];
      for (const morphName of path) {
        const step = F.onMorphisms[morphName];
        if (step === undefined) return null; // already reported elsewhere
        out.push(...step);
      }
      return out;
    };

    const leftInSource = buildSourcePath(eq.left);
    const rightInSource = buildSourcePath(eq.right);
    if (leftInSource === null || rightInSource === null) continue;

    if (!pathsAreDeclaredEqual(sourceSchema, mappedFrom, leftInSource, rightInSource)) {
      violations.push({
        reason: 'equation-not-respected', subject: eq.name,
        detail: `F does not respect equation "${eq.name}": F(${eq.left.join(', ')}) = [${leftInSource.join(', ')}] and F(${eq.right.join(', ')}) = [${rightInSource.join(', ')}], which are not declared equal in the source schema — data satisfying the target's equation could migrate to data that violates the source's`,
      });
    }
  }

  return { isFunctor: violations.length === 0, violations };
}

/**
 * Δ_F(sourceInstance) — the pullback of `sourceInstance` along F, yielding
 * a targetSchema-shaped Instance. Purely structural: target rows ARE the
 * corresponding source rows (same objects, relabeled), target morphisms
 * ARE the composite of the declared source path, applied pointwise.
 *
 * If F passes checkSchemaMappingLaws AND sourceInstance passes
 * checkInstanceIsFunctor, the result of deltaF is GUARANTEED to also pass
 * checkInstanceIsFunctor — functors compose. If sourceInstance is itself
 * broken (e.g. non-total somewhere along a used path), that brokenness
 * propagates honestly into the derived instance rather than being hidden.
 */
export function deltaF(
  F: SchemaMapping,
  sourceInstance: Instance,
  targetSchema: DomainSchema,
): Instance {
  const rows: Record<string, Row[]> = {};
  for (const [tObj, sObj] of Object.entries(F.onObjects)) {
    rows[tObj] = sourceInstance.rows[sObj] ?? [];
  }

  const fk: Record<string, Record<string, string>> = {};
  for (const m of targetSchema.morphisms) {
    const path = F.onMorphisms[m.name] ?? [];
    const sourceObjName = F.onObjects[m.from];
    const sourceRows = sourceInstance.rows[sourceObjName] ?? [];
    const map: Record<string, string> = {};

    for (const row of sourceRows) {
      let cursor: string | undefined = row.id;
      for (const morphName of path) {
        cursor = cursor === undefined ? undefined : sourceInstance.fk[morphName]?.[cursor];
        if (cursor === undefined) break;
      }
      if (cursor !== undefined) map[row.id] = cursor;
      // if cursor is undefined, sourceInstance was non-total along this path
      // for this row — we honestly omit it rather than fabricate a value;
      // checkInstanceIsFunctor on the result will correctly flag it.
    }
    fk[m.name] = map;
  }

  return { rows, fk };
}

/**
 * NOT part of Δ_F — a clearly-separated, pragmatic extension (in the
 * spirit of CQL's "typeside" functions; see categoricaldata.net) for the
 * cases pure structural migration can't cover: computing a genuinely new
 * attribute value from a row's existing data. Δ_F still owns which-row-
 * maps-to-which-row; this only ever touches attributes on rows Δ_F already
 * placed correctly.
 */
export function withDerivedAttributes(
  instance: Instance,
  object: string,
  derive: (row: Row) => Record<string, unknown>,
): Instance {
  return {
    ...instance,
    rows: {
      ...instance.rows,
      [object]: (instance.rows[object] ?? []).map((row) => ({ ...row, ...derive(row) })),
    },
  };
}
