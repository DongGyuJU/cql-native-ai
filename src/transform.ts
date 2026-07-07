// src/transform.ts
// NaturalTransformation — structured communication between two agents.
//
//   η : F_A ⇒ F_B ∘ G
//
// where G : C_A → C_B is a Domain Translation Functor supplied by the
// user (how to re-express an A-event in B's language), and η delivers
// F_A's insight into F_B's analysis as context.
//
// checkNaturality() empirically tests the naturality condition:
// processing order must not change the target agent's conclusion.

import { DomainAgent } from './agent';
import { DomainInsight, HistoryEntry } from './types';

/** G : C_A → C_B on objects. */
export interface DomainTranslation<A, B> {
  translateInput(input: A): B;
}

export interface TransformResult<RawA = unknown, RawB = unknown> {
  sourceInsight: DomainInsight<RawA>;
  targetInsight: DomainInsight<RawB>;
}

export interface NaturalityReport {
  consistent: boolean;
  /** Similarity in [0,1] between the two processing orders */
  similarity: number;
  details: {
    statusMatch: boolean;
    headlineSimilarity: number;
    forward: DomainInsight;
    reversed: DomainInsight;
  };
}

export class NaturalTransformation<A = unknown, B = unknown> {
  constructor(
    private readonly source: DomainAgent<A, any>,
    private readonly target: DomainAgent<B, any>,
    private readonly translation: DomainTranslation<A, B>,
  ) {}

  /**
   * Apply η at a single input:
   *   1. F_A(input)                    — source insight
   *   2. G(input)                      — translate to target domain
   *   3. F_B(G(input), context=F_A(x)) — target insight, informed by source
   */
  async apply(
    input: A,
    history: HistoryEntry[] = [],
  ): Promise<TransformResult> {
    const sourceInsight = await this.source.analyze(input, history);
    const translated = this.translation.translateInput(input);
    const targetInsight = await this.target.analyze(translated, history, {
      context: [sourceInsight],
    });
    return { sourceInsight, targetInsight };
  }

  /**
   * Empirical naturality check.
   *
   * Naturality demands the square commutes: for inputs x1, x2 the
   * target conclusion must not depend on processing order. LLM-backed
   * agents can violate this; this method measures how badly.
   *
   * We compare F_B applied after [x1 then x2] vs [x2 then x1] and
   * report status equality + headline similarity.
   */
  async checkNaturality(
    inputs: [A, A],
    history: HistoryEntry[] = [],
    threshold = 0.8,
  ): Promise<NaturalityReport> {
    const [x1, x2] = inputs;

    // forward order: x1 context feeds x2 analysis
    const s1 = await this.source.analyze(x1, history);
    const forward = await this.target.analyze(
      this.translation.translateInput(x2),
      history,
      { context: [s1] },
    );

    // reversed order: x2 context feeds x1 analysis... then re-run x2 path
    const s2 = await this.source.analyze(x2, history);
    const reversed = await this.target.analyze(
      this.translation.translateInput(x2),
      history,
      { context: [s2, s1] }, // same information, different arrival order
    );

    const statusMatch = forward.status === reversed.status;
    const headlineSimilarity = jaccard(forward.headline, reversed.headline);
    const similarity = (Number(statusMatch) + headlineSimilarity) / 2;

    return {
      consistent: similarity >= threshold,
      similarity,
      details: { statusMatch, headlineSimilarity, forward, reversed },
    };
  }
}

/** Token-level Jaccard similarity of two strings. */
function jaccard(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const tb = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}
