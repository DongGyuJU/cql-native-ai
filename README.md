# cql-native-ai

[![CI](https://github.com/DongGyuJU/cql-native-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/DongGyuJU/cql-native-ai/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/badge/npm-not_yet_published-lightgrey)](https://www.npmjs.com/package/cql-native-ai)
[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/DongGyuJU/cql-native-ai)

> **Category Theory-based Multi-Agent AI framework.**
> Domains as **Categories**, agents as **Functors**, communication as **Natural Transformations**, Meta AI as a **Lax Colimit**.

📖 New here? [**Add your own domain in 10 minutes →**](docs/tutorial.md)

Zero-dependency core. Works with any LLM (or none — rule-based agents are first-class).

```bash
npm install cql-native-ai
# or straight from GitHub (pre-release):
npm install github:DongGyuJU/cql-native-ai
```

## Why

Existing multi-agent frameworks (LangGraph, CrewAI) let agents talk in free-form natural language. Structure is lost, consistency is not guaranteed, and adding a domain means rewiring the system.

CQL Native AI enforces one mathematically-defined interface — `DomainInsight` — as the codomain of every agent:

| Category Theory | This library |
|---|---|
| Object (domain) | `DomainDefinition` |
| Functor `F_d : C_d × H → Insight` | `DomainAgent` |
| Natural Transformation `η : F_A ⇒ F_B ∘ G` | `NaturalTransformation` |
| Lax Colimit `laxcolim F_d` | `MetaAgent` |
| Index Category `D` | `DomainRegistry` |

**Consequences:**
- Agents can be rules, classical ML, or LLM calls — the interface is identical.
- Adding a domain = one `registry.register()` call. The Meta Agent, classifier prompts, and keyword inference adapt automatically (extensibility by the colimit's universal property).
- `checkNaturality()` empirically tests whether an LLM-backed pipeline violates order-independence.

## How this compares

| | Structure guarantee | Adding a domain | Works without an LLM |
|---|---|---|---|
| Prompt engineering (raw LLM) | none | rewrite prompts | no |
| LangGraph / CrewAI | graph, but agent-to-agent is free text | rewire the graph | no |
| **cql-native-ai** | typed `DomainInsight` interface + empirical naturality check | one `registry.register()` call | yes (rule-based agents are first-class) |

## Quick start

```ts
import { createAgent, DomainRegistry, MetaAgent } from 'cql-native-ai';

// 1. A domain (Category) + agent (Functor) — pure rules, no LLM
const sleepAgent = createAgent<{ hours: number }>(
  { id: 'sleep', name: 'Sleep', description: 'Sleep duration analysis' },
  (input) => ({
    domain: 'sleep',
    status: input.hours < 7 ? 'warning' : 'good',
    headline: `${input.hours}h sleep`,
    detail: input.hours < 7 ? 'Below the 7-9h recommendation.' : 'Healthy range.',
    recommendation: input.hours < 7 ? 'Aim for 23:00 tonight' : 'Keep it up',
    confidence: 0.95,
  }),
);

// 2. Registry (Index Category) + Meta Agent (Lax Colimit)
const registry = new DomainRegistry().register(sleepAgent);
const meta = new MetaAgent(registry);

const unified = await meta.run({ inputs: { sleep: { hours: 5.5 } } });
console.log(unified.insight);          // synthesized narrative
console.log(unified.warningDomains);   // ['sleep']
```

## LLM-backed agents

```ts
import { createLLMAgent, groqProvider, createLLMSynthesizer, MetaAgent } from 'cql-native-ai';

const provider = groqProvider(process.env.GROQ_API_KEY!);

const caffeineAgent = createLLMAgent({
  domain: {
    id: 'caffeine',
    name: 'Caffeine',
    description: 'Cortisol-aware caffeine timing (Huberman 2021)',
    keywords: ['coffee', 'americano', 'latte'],
  },
  provider,
  fallback: (input) => ({          // deterministic fallback if LLM fails
    domain: 'caffeine',
    status: 'info',
    headline: 'rule-based fallback',
    detail: 'LLM unavailable; using cortisol window rules.',
    recommendation: 'Drink coffee 90-120 min after waking',
    confidence: 0.6,
  }),
});

// LLM-synthesized Meta narrative instead of the default template:
const meta = new MetaAgent(registry, createLLMSynthesizer(provider, { language: 'Korean' }));
```

Any OpenAI-compatible endpoint works:

```ts
import { OpenAICompatProvider } from 'cql-native-ai';
const local = new OpenAICompatProvider({
  baseURL: 'http://localhost:11434/v1', // Ollama
  apiKey: 'none',
  model: 'qwen2.5:1.5b',
});
```

## Natural Transformations (cross-domain communication)

```ts
import { NaturalTransformation } from 'cql-native-ai';

// η : F_hr ⇒ F_engineering ∘ G
const hrToEng = new NaturalTransformation(hrAgent, engAgent, {
  translateInput: (hr) => ({            // G : C_hr → C_eng
    velocityRatio: 0.95 - hr.attritionRate * 1.5,
    pagesPerEngineer: 3 + hr.openRoles * 0.5,
    sev1Incidents: 1,
  }),
});

const { sourceInsight, targetInsight } = await hrToEng.apply(hrData);

// Empirical naturality check — does processing order change conclusions?
const report = await hrToEng.checkNaturality([q1Data, q2Data]);
console.log(report.consistent, report.similarity);
```

## Temporal propagation (the C×H axis) — v0.2.0

Time-dependent propagation ("this segment reacts to what its upstream
neighbor looked like one tick ago") used to require a hand-rolled
previous-tick variable in every demo. `TemporalRunner` makes it a
first-class feature with one provable rule: **during tick t, every agent
reads the same frozen snapshot of tick t−1.**

```ts
import { createAgent, DomainRegistry, MetaAgent, TemporalRunner } from 'cql-native-ai';

const seg1 = createAgent({ id: 'seg1', name: 'Segment 1' },
  (input, history, options) => {
    let speed = input.speed;
    const prev = options?.temporal?.previousInsight('seg0'); // upstream, PREVIOUS tick
    if (prev?.status === 'warning') speed = Math.min(speed, 12);
    return { domain: 'seg1', status: speed < 20 ? 'warning' : 'good',
             headline: `${speed}km/h`, detail: '', recommendation: '', confidence: 1 };
  });

const runner = new TemporalRunner(new MetaAgent(registry));
await runner.step(inputs);   // tick 0 — previous* are undefined (no fabricated history)
await runner.step(inputs);   // tick 1 — sees tick 0's frozen snapshot
```

Pinned by tests: (1) tick 0 has no previous state; (2) tick t reads
exactly t−1; (3) the snapshot is immutable within a tick, so registration
order cannot change results — order invariance extends across the time
axis; (4) on a chain, a disturbance first reaches node u exactly at
graph-distance ticks (1 tick/hop) — the property the city-scale benchmark
verified empirically is now a library guarantee. Per-domain history is
bounded (`historyDepth`, default 20) so long-running dashboards cannot
grow memory without limit. See `examples/temporal-propagation.ts`.

## Testing

The test suite exercises the framework's core guarantees directly:
`DomainAgent` output validation, `DomainRegistry` extensibility (Proposition 2),
`MetaAgent`'s no-information-loss colimit, and `checkNaturality()`'s ability
to detect order-dependence.

```bash
npm test
```

## Full example

See [`examples/company-network.ts`](examples/company-network.ts) — three departments (HR / Engineering / Finance) as domains, HR⇒Engineering natural transformation, CEO dashboard as the Meta Agent, and live extensibility (registering a Sales domain with zero other changes).

```
npm run example
```

## API surface

```
Types      DomainInsight, UnifiedInsight, DomainDefinition, HistoryEntry
Core       createAgent, DomainAgent, DomainRegistry, MetaAgent
CT ops     NaturalTransformation (.apply / .checkNaturality)
LLM        LLMProvider, OpenAICompatProvider, groqProvider,
           createLLMAgent, createLLMSynthesizer
Runtime    validateInsight, coerceInsight, TemplateSynthesizer
```

## Relation to the theory

- The `DomainInsight` type is the component of every natural transformation — sharing this codomain is what makes agent outputs composable without information loss.
- `MetaAgent.run()` implements the lax colimit: every contributing insight is preserved in `UnifiedInsight.contributing` (universal property → auditability), and synthesis never drops a domain.
- `checkNaturality()` acknowledges that LLM-backed functors are only *approximately* functorial; it measures the violation instead of assuming it away.

Reference implementation: [LiIn (Life Insight)](https://github.com/DongGyuJU/life-insight-app) — a life-logging ecosystem with 6 domain agents.

## License

MIT
