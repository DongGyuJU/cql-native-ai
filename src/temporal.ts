// src/temporal.ts
//
// Formalizes the History axis (the C×H product category) as a first-class
// runtime feature, replacing the hand-rolled "previous-tick variable"
// pattern that the gangnam-road dashboard, both control-room demos, and
// the city propagation benchmark each reimplemented independently (this
// was Limitation 4 of the technical paper).
//
// The semantics that make time-axis propagation provably well-behaved:
//
//   SNAPSHOT RULE. During tick t, every agent reads the SAME frozen
//   snapshot of tick t-1 (inputs and insights). No agent can observe
//   any tick-t effect of any other agent.
//
// Two consequences follow, and are pinned by unit tests:
//   (1) Order invariance across time: since the snapshot is immutable
//       for the duration of a tick, agent evaluation order cannot
//       influence results — the same property MetaAgent already has
//       within a tick now provably extends across ticks.
//   (2) Distance-delay correspondence: on a graph of domains where each
//       node reacts to its neighbors' previous-tick state, a disturbance
//       introduced at node v first affects node u exactly at tick
//       d(v, u) — graph distance, at one tick per hop. This is the
//       behavior the city-scale benchmark verified empirically (100%,
//       zero deviation, up to 2500 nodes); TemporalRunner makes the
//       mechanism it verified a library guarantee rather than a
//       per-demo reimplementation.

import { MetaAgent, MetaRunInput } from './meta';
import {
  DomainInsight,
  UnifiedInsight,
  HistoryEntry,
  AnalyzeOptions,
  TemporalContext,
} from './types';

export interface TemporalRunnerOptions {
  /**
   * How many past ticks of per-domain history to retain (each entry is
   * one HistoryEntry per domain per tick). Bounded so long-running
   * dashboards cannot grow memory without limit — the same concern that
   * motivated the Π_F row cap. Default: 20.
   */
  historyDepth?: number;
}

interface TickSnapshot {
  tick: number;
  inputs: Record<string, unknown>;
  insights: Record<string, DomainInsight>;
}

export class TemporalRunner {
  private meta: MetaAgent;
  private depth: number;
  private currentTick = 0;
  private previousSnapshot?: TickSnapshot;
  private histories = new Map<string, HistoryEntry[]>();

  constructor(meta: MetaAgent, options: TemporalRunnerOptions = {}) {
    this.meta = meta;
    this.depth = options.historyDepth ?? 20;
  }

  /** Current tick number (number of completed step() calls). */
  get tick(): number {
    return this.currentTick;
  }

  /**
   * Advance one tick: run every agent against `inputs`, giving each
   * (a) its OWN per-domain history (bounded by historyDepth), and
   * (b) a read-only TemporalContext over the frozen previous tick.
   *
   * extraOptions lets callers still pass Natural-Transformation context
   * or extras per domain; the temporal field is always overwritten by
   * the runner so the snapshot rule cannot be bypassed accidentally.
   */
  async step(
    inputs: Record<string, unknown>,
    extraOptions?: (domainId: string) => AnalyzeOptions,
  ): Promise<UnifiedInsight> {
    // Freeze the previous tick as an immutable view. Capturing the
    // reference into a local const matters: even if step() is called
    // again while an agent holds this context, lookups keep answering
    // from the tick that was "previous" when THIS tick started.
    const snapshot = this.previousSnapshot;
    const tickNow = this.currentTick;

    const temporal: TemporalContext = {
      tick: tickNow,
      previousInput: (domainId: string) => snapshot?.inputs[domainId],
      previousInsight: (domainId: string) => snapshot?.insights[domainId],
    };

    const runInput: MetaRunInput = {
      inputs,
      historyFor: (id) => this.histories.get(id) ?? [],
      optionsFor: (id) => ({ ...(extraOptions?.(id) ?? {}), temporal }),
    };

    const unified = await this.meta.run(runInput);

    // Record this tick as the next tick's "previous".
    const insightsById: Record<string, DomainInsight> = {};
    for (const ins of unified.contributing) insightsById[ins.domain] = ins;
    this.previousSnapshot = { tick: tickNow, inputs: { ...inputs }, insights: insightsById };

    // Append per-domain history (each domain's own past inputs), bounded.
    const stamp = new Date().toISOString();
    for (const [id, data] of Object.entries(inputs)) {
      const h = this.histories.get(id) ?? [];
      h.push({ timestamp: stamp, data });
      if (h.length > this.depth) h.splice(0, h.length - this.depth);
      this.histories.set(id, h);
    }

    this.currentTick++;
    return unified;
  }

  /** A domain's own bounded input history (oldest first). */
  historyOf(domainId: string): HistoryEntry[] {
    return [...(this.histories.get(domainId) ?? [])];
  }

  /** Reset to tick 0, clearing all history and the previous snapshot. */
  reset(): void {
    this.currentTick = 0;
    this.previousSnapshot = undefined;
    this.histories.clear();
  }
}
