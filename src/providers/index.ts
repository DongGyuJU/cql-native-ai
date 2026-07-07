// src/providers/index.ts
// Pluggable LLM backends + factories for LLM-backed agents/synthesizers.
//
// The core library is LLM-agnostic: agents can be pure rules, classical
// ML, or LLM calls. These helpers cover the common LLM case with any
// OpenAI-compatible chat endpoint (Groq, OpenAI, vLLM, Ollama, ...).

import { AnalyzeFn, createAgent, DomainAgent } from '../agent';
import { MetaSynthesizer } from '../meta';
import {
  AnalyzeOptions,
  DomainDefinition,
  DomainInsight,
  HistoryEntry,
} from '../types';
import { coerceInsight } from '../validate';

/** Minimal LLM interface. Implement this to plug in any backend. */
export interface LLMProvider {
  complete(
    prompt: string,
    opts?: { temperature?: number; system?: string },
  ): Promise<string>;
}

/** Any OpenAI-compatible /chat/completions endpoint. */
export class OpenAICompatProvider implements LLMProvider {
  constructor(
    private readonly cfg: {
      baseURL: string; // e.g. "https://api.groq.com/openai/v1"
      apiKey: string;
      model: string; // e.g. "llama-3.1-8b-instant"
      fetchImpl?: typeof fetch;
    },
  ) {}

  async complete(
    prompt: string,
    opts: { temperature?: number; system?: string } = {},
  ): Promise<string> {
    const f = this.cfg.fetchImpl ?? fetch;
    const messages: Array<{ role: string; content: string }> = [];
    if (opts.system) messages.push({ role: 'system', content: opts.system });
    messages.push({ role: 'user', content: prompt });

    const res = await f(`${this.cfg.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: this.cfg.model,
        messages,
        temperature: opts.temperature ?? 0.3,
      }),
    });
    if (!res.ok) {
      throw new Error(`[cql-native-ai] LLM HTTP ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as any;
    return String(data.choices?.[0]?.message?.content ?? '').trim();
  }
}

/** Groq convenience wrapper. */
export function groqProvider(apiKey: string, model = 'llama-3.1-8b-instant') {
  return new OpenAICompatProvider({
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey,
    model,
  });
}

// ────────────────────────────────────────────────────────────────
// LLM-backed Domain Agent factory
// ────────────────────────────────────────────────────────────────

export interface LLMAgentConfig<Input> {
  domain: DomainDefinition;
  provider: LLMProvider;
  /**
   * Build the analysis prompt. Must instruct the model to answer with
   * a single JSON object: { status, headline, detail, recommendation, confidence }.
   * A hardened default is used if omitted.
   */
  buildPrompt?: (
    input: Input,
    history: HistoryEntry[],
    options: AnalyzeOptions,
  ) => string;
  /** Deterministic fallback if the LLM output cannot be parsed. */
  fallback?: (input: Input, history: HistoryEntry[]) => DomainInsight;
  temperature?: number;
}

export function createLLMAgent<Input = unknown>(
  cfg: LLMAgentConfig<Input>,
): DomainAgent<Input> {
  const analyze: AnalyzeFn<Input> = async (input, history, options) => {
    const prompt =
      cfg.buildPrompt?.(input, history, options) ??
      defaultAgentPrompt(cfg.domain, input, history, options);

    try {
      const raw = await cfg.provider.complete(prompt, {
        temperature: cfg.temperature ?? 0.3,
      });
      const parsed = extractJSON(raw);
      if (parsed) return coerceInsight(parsed, cfg.domain.id);
      throw new Error('no JSON found in LLM output');
    } catch (err) {
      if (cfg.fallback) return cfg.fallback(input, history);
      throw err;
    }
  };
  return createAgent(cfg.domain, analyze);
}

function defaultAgentPrompt(
  domain: DomainDefinition,
  input: unknown,
  history: HistoryEntry[],
  options: AnalyzeOptions,
): string {
  const ctx = options.context?.length
    ? `\nContext from other agents:\n${options.context
        .map((c) => `- [${c.domain}/${c.status}] ${c.headline}: ${c.detail}`)
        .join('\n')}`
    : '';
  const hist = history.length
    ? `\nRecent history (${history.length} entries):\n${history
        .slice(-10)
        .map((h) => `- ${h.timestamp}: ${JSON.stringify(h.data)}`)
        .join('\n')}`
    : '';
  return `You are the "${domain.name}" domain analysis agent.
${domain.description ?? ''}

Input data:
${JSON.stringify(input, null, 2)}
${hist}${ctx}

Analyze the input and respond with ONLY this JSON object, no prose:
{
  "status": "good" | "warning" | "info",
  "headline": "<= 40 chars summary",
  "detail": "1-2 sentence analysis",
  "recommendation": "one actionable suggestion",
  "confidence": 0.0-1.0
}`;
}

/** Extract first JSON object from an LLM response. */
export function extractJSON(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json|```/g, '');
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────
// LLM-backed Meta Synthesizer
// ────────────────────────────────────────────────────────────────

export function createLLMSynthesizer(
  provider: LLMProvider,
  opts: { temperature?: number; language?: string } = {},
): MetaSynthesizer {
  return {
    async synthesize(insights: DomainInsight[], context) {
      const warn = insights.filter((i) => i.status === 'warning');
      const prompt = `You are a Meta AI that synthesizes analyses from multiple domain agents.

Available domains:
${context.domainContext}

Domain agent results:
${insights
  .map(
    (d) => `[${d.domain.toUpperCase()} — ${d.status}, confidence ${Math.round(
      d.confidence * 100,
    )}%]
  headline: ${d.headline}
  detail: ${d.detail}
  recommendation: ${d.recommendation}`,
  )
  .join('\n\n')}

Rules:
1. ${
        warn.length
          ? `Focus on warning domains (${warn.map((d) => d.domain).join(', ')}).`
          : 'Overall status is good — reinforce it.'
      }
2. Point out cross-domain causal links when plausible.
3. Mention low-confidence domains need more data.
4. End with ONE concrete action for today.
5. 2-4 sentences, warm and personal tone.${
        opts.language ? ` Respond in ${opts.language}.` : ''
      }

Respond with plain text only, no JSON.`;
      return provider.complete(prompt, {
        temperature: opts.temperature ?? 0.6,
      });
    },
  };
}
