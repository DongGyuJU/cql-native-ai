// src/registry.ts
// DomainRegistry — the index category D.
//
// Objects of D are the registered domains. The registry is the single
// source of truth: registering a domain automatically makes it visible
// to the Meta Agent, to text classification prompts, and to keyword
// inference. This is what implements Proposition 2 (extensibility):
// adding a domain = adding one Object, nothing else changes.

import { DomainAgent } from './agent';
import { DomainDefinition } from './types';

export class DomainRegistry {
  private agents = new Map<string, DomainAgent<any, any>>();

  /** Add (or replace) a Domain Agent. Returns the registry for chaining. */
  register(agent: DomainAgent<any, any>): this {
    this.agents.set(agent.domain.id, agent);
    return this;
  }

  unregister(domainId: string): boolean {
    return this.agents.delete(domainId);
  }

  get(domainId: string): DomainAgent<any, any> | undefined {
    return this.agents.get(domainId);
  }

  has(domainId: string): boolean {
    return this.agents.has(domainId);
  }

  /** All active agents (Objects of D). */
  list(): DomainAgent<any, any>[] {
    return [...this.agents.values()].filter(
      (a) => a.domain.active !== false,
    );
  }

  /** All active domain definitions. */
  domains(): DomainDefinition[] {
    return this.list().map((a) => a.domain);
  }

  /**
   * Keyword-based domain inference over free text.
   * Useful as a cheap pre-classifier before invoking an LLM.
   */
  inferDomains(text: string): DomainDefinition[] {
    const lower = text.toLowerCase();
    return this.domains().filter((d) =>
      (d.keywords ?? []).some((kw) => lower.includes(kw.toLowerCase())),
    );
  }

  /**
   * Build a classifier prompt section listing every active domain.
   * Feed this into any LLM that must map free text → domain ids.
   * Because it is generated from the registry, adding a domain
   * automatically updates classification behavior.
   */
  buildClassifierPrompt(): string {
    const lines = this.domains().map((d) => {
      const kw = d.keywords?.length ? ` (signals: ${d.keywords.join(', ')})` : '';
      return `- ${d.id}: ${d.description ?? d.name}${kw}`;
    });
    return lines.join('\n');
  }

  /**
   * Build the Meta Agent context section: one line per domain
   * describing what it contributes.
   */
  buildMetaContext(): string {
    return this.domains()
      .map((d) => `${d.name} (${d.id}): ${d.metaSummaryTemplate ?? d.description ?? ''}`)
      .join('\n');
  }

  /** Serialize registry definitions (e.g. to persist as JSON). */
  toJSON(): DomainDefinition[] {
    return this.domains();
  }
}
