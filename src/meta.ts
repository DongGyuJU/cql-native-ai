// src/meta.ts
// MetaAgent — the lax colimit over all registered Domain Agents.
//
//   F_meta : laxcolim_{d ∈ D} F_d → UnifiedInsight
//
// Every DomainInsight is preserved in `contributing` (no information
// loss — the colimit's universal property), and a Synthesizer turns
// them into one natural-language insight.

import { DomainRegistry } from './registry';
import {
  DomainInsight,
  HistoryEntry,
  UnifiedInsight,
  errorInsight,
} from './types';

/** Turns a set of DomainInsights into one unified narrative. */
export interface MetaSynthesizer {
  synthesize(
    insights: DomainInsight[],
    context: { domainContext: string },
  ): Promise<string>;
}

/** Zero-dependency default: deterministic template synthesis. */
export class TemplateSynthesizer implements MetaSynthesizer {
  async synthesize(insights: DomainInsight[]): Promise<string> {
    const warn = insights.filter((i) => i.status === 'warning');
    const good = insights.filter((i) => i.status === 'good');
    const parts: string[] = [];
    if (warn.length) {
      parts.push(
        `Attention needed: ${warn
          .map((i) => `${i.domain} (${i.headline})`)
          .join(', ')}.`,
      );
      const top = warn.sort((a, b) => b.confidence - a.confidence)[0];
      if (top?.recommendation) parts.push(`Recommended action: ${top.recommendation}`);
    }
    if (good.length) {
      parts.push(`On track: ${good.map((i) => i.domain).join(', ')}.`);
    }
    if (!parts.length) parts.push('Not enough data yet — keep logging.');
    return parts.join(' ');
  }
}

export interface MetaRunInput {
  /** domainId → input for that agent. Missing ids are skipped. */
  inputs: Record<string, unknown>;
  history?: HistoryEntry[];
}

export class MetaAgent {
  constructor(
    private readonly registry: DomainRegistry,
    private readonly synthesizer: MetaSynthesizer = new TemplateSynthesizer(),
  ) {}

  /**
   * Run the lax colimit:
   *   1. fan out to every registered agent that has input (in parallel)
   *   2. collect all DomainInsights (errors become error-insights,
   *      keeping the colimit total)
   *   3. synthesize a UnifiedInsight
   */
  async run({ inputs, history = [] }: MetaRunInput): Promise<UnifiedInsight> {
    const agents = this.registry
      .list()
      .filter((a) => inputs[a.domain.id] !== undefined);

    const insights: DomainInsight[] = await Promise.all(
      agents.map((a) =>
        a
          .analyze(inputs[a.domain.id], history)
          .catch((err) => errorInsight(a.domain.id, err)),
      ),
    );

    const text = await this.synthesizer.synthesize(insights, {
      domainContext: this.registry.buildMetaContext(),
    });

    return {
      insight: text,
      warningDomains: insights
        .filter((i) => i.status === 'warning')
        .map((i) => i.domain),
      goodDomains: insights
        .filter((i) => i.status === 'good')
        .map((i) => i.domain),
      contributing: insights,
      meta: {
        activeDomainCount: this.registry.list().length,
        analyzedDomainCount: insights.length,
        generatedAt: new Date().toISOString(),
      },
    };
  }
}
