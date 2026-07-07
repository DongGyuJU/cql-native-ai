// src/agent.ts
// DomainAgent — the Functor F_d : C_d × H → DomainInsight.
//
// A DomainAgent wraps a user-provided analyze function. The library
// guarantees that whatever the function does internally (rules, LLM,
// classical ML), the OUTPUT always satisfies the DomainInsight
// interface — i.e. the functor always lands in the shared codomain
// that makes Natural Transformations possible.

import {
  AnalyzeOptions,
  DomainDefinition,
  DomainInsight,
  HistoryEntry,
} from './types';
import { validateInsight } from './validate';

export type AnalyzeFn<Input, Raw = unknown> = (
  input: Input,
  history: HistoryEntry[],
  options: AnalyzeOptions,
) => Promise<DomainInsight<Raw>> | DomainInsight<Raw>;

export class DomainAgent<Input = unknown, Raw = unknown> {
  constructor(
    public readonly domain: DomainDefinition,
    private readonly analyzeFn: AnalyzeFn<Input, Raw>,
  ) {
    if (!domain.id) throw new Error('[cql-native-ai] domain.id is required');
  }

  /**
   * Apply the functor: F_d(input, history) → DomainInsight.
   * Output is runtime-validated so downstream consumers (Meta Agent,
   * Natural Transformations) can rely on the interface.
   */
  async analyze(
    input: Input,
    history: HistoryEntry[] = [],
    options: AnalyzeOptions = {},
  ): Promise<DomainInsight<Raw>> {
    const insight = await this.analyzeFn(input, history, options);
    validateInsight(insight, this.domain.id);
    if (!insight.timestamp) insight.timestamp = new Date().toISOString();
    return insight;
  }
}

/** Convenience constructor. */
export function createAgent<Input = unknown, Raw = unknown>(
  domain: DomainDefinition,
  analyzeFn: AnalyzeFn<Input, Raw>,
): DomainAgent<Input, Raw> {
  return new DomainAgent(domain, analyzeFn);
}
