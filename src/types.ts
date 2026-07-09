// src/types.ts
// Core types of CQL Native AI.
//
// Category Theory mapping:
//   DomainInsight  = the component of a Natural Transformation.
//                    Every Domain Agent (Functor) maps into this shared
//                    codomain, which is what guarantees structure-preserving
//                    communication between agents.
//   UnifiedInsight = the object produced by the Meta Agent (lax colimit).

export type InsightStatus = 'good' | 'warning' | 'info' | 'error';

/**
 * DomainInsight — the standardized output of every Domain Agent.
 *
 * This type IS the inter-agent communication protocol.
 * All Domain Agents (Functors F_d) share this codomain, so the
 * naturality condition is enforced at the type level.
 */
export interface DomainInsight<Raw = unknown> {
  /** Domain id this insight belongs to (e.g. "caffeine", "hr", "traffic") */
  domain: string;
  /** Overall status signal used by the Meta Agent for prioritization */
  status: InsightStatus;
  /** One-line summary (<= ~40 chars recommended) */
  headline: string;
  /** 1-3 sentence analysis */
  detail: string;
  /** One actionable recommendation */
  recommendation: string;
  /** 0..1 — how much data supports this insight */
  confidence: number;
  /** Structured numbers/fields the Meta Agent may reference */
  rawData?: Raw;
  /** ISO timestamp of when the insight was produced */
  timestamp?: string;
}

/** Output of the Meta Agent (lax colimit over all DomainInsights). */
export interface UnifiedInsight {
  /** Natural-language synthesis across all domains */
  insight: string;
  warningDomains: string[];
  goodDomains: string[];
  /** Every DomainInsight that contributed, for auditability */
  contributing: DomainInsight[];
  meta?: Record<string, unknown>;
}

/** A single history entry (object of the History Category H). */
export interface HistoryEntry<T = unknown> {
  timestamp: string; // ISO date
  data: T;
}

/** Options passed through to agent analysis. */
export interface AnalyzeOptions {
  /** Insights from other agents, delivered via Natural Transformation */
  context?: DomainInsight[];
  /** Arbitrary extras (locale, user profile, ...) */
  extras?: Record<string, unknown>;
}

/** Morphism of a Domain Category: a directed relation between objects. */
export interface DomainRelation {
  from: string;
  to: string;
  label?: string;
}

/**
 * DomainDefinition — the Domain Category C_d, declaratively.
 *
 * Objects  = keys of `schema`
 * Morphisms = `relations`
 */
export interface DomainDefinition {
  /** Unique id, e.g. "caffeine", "hr", "road_segment" */
  id: string;
  /** Human-readable name */
  name: string;
  /** Short description used in classifier / meta prompts */
  description?: string;
  /** Keywords that signal this domain in free text (used by Registry.inferDomains) */
  keywords?: string[];
  /** Objects of the category: entity name -> field description */
  schema?: Record<string, string>;
  /** Morphisms of the category */
  relations?: DomainRelation[];
  /** One-line template describing what this domain contributes to Meta AI */
  metaSummaryTemplate?: string;
  /** Inactive domains are ignored by Registry/Meta */
  active?: boolean;
  /**
   * Phase A: the machine-checkable version of this domain's Category
   * (Objects with typed attributes + generating Morphisms). Optional —
   * `schema`/`relations` above remain the lightweight human/prompt-facing
   * description. When present, `typedSchema` can be used with
   * `checkInstanceIsFunctor()` from `./schema` to verify that a concrete
   * dataset is actually a valid functor into this domain's category
   * (equivalently: has no dangling foreign keys / missing links).
   * See `./schema` for `DomainSchema`, `Instance`, `InstanceBuilder`.
   */
  typedSchema?: import('./schema').DomainSchema;
}

/** Error-shaped insight used when an agent throws. Keeps the colimit total. */
export function errorInsight(domain: string, err: unknown): DomainInsight {
  return {
    domain,
    status: 'error',
    headline: 'analysis failed',
    detail: err instanceof Error ? err.message : String(err),
    recommendation: 'check agent implementation or input data',
    confidence: 0,
    timestamp: new Date().toISOString(),
  };
}
