# cql-native-ai

[![CI](https://github.com/DongGyuJU/cql-native-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/DongGyuJU/cql-native-ai/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/badge/npm-not_yet_published-lightgrey)](https://www.npmjs.com/package/cql-native-ai)

> **Category Theory-based Multi-Agent AI framework.**
> Domains as **Categories**, agents as **Functors**, communication as **Natural Transformations**, Meta AI as a **Lax Colimit**.

Zero-dependency core. Works with any LLM (or none — rule-based agents are first-class).

```
npm install cql-native-ai
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
