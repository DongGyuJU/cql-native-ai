# Add Your Own Domain in 10 Minutes

This walkthrough takes you from `npm install` to a running multi-domain
Meta Agent — on a domain of your own. No LLM API key required until the
optional last step.

We'll build a **support-ticket triage** domain (deliberately not one of
the built-in examples, to show the framework doesn't care what your
domain is).

---

## Install

```bash
npm install cql-native-ai
# or, straight from GitHub (pre-release):
npm install github:DongGyuJU/cql-native-ai
```

---

## Step 1 — Define your Domain

A `DomainDefinition` is the *Category* your data lives in — you're
declaring what entities exist and how they relate, before writing any
analysis logic.

```ts
import { DomainDefinition } from 'cql-native-ai';

const ticketDomain: DomainDefinition = {
  id: 'tickets',
  name: 'Support Tickets',
  description: 'Incoming customer support ticket triage',
  keywords: ['ticket', 'refund', 'bug', 'complaint', 'support'],
  schema: {
    Ticket: 'id, severity, ageHours, customerTier',
    Queue: 'open ticket count, oldest ticket age',
  },
  relations: [{ from: 'Queue', to: 'Ticket', label: 'contains' }],
  metaSummaryTemplate: 'Support health: queue pressure and SLA risk',
};
```

What each field is **for** (not just its type):

- `keywords` — lets `registry.inferDomains(freeText)` route raw text to
  your domain without an LLM call. Put the words your users actually type.
- `schema` — the *Objects* of your category. Documentation for humans and
  prompt context for LLM-backed agents.
- `relations` — the *Morphisms*: which entities affect which. Not enforced
  at runtime (yet); they document the structure your agent should respect.
- `metaSummaryTemplate` — one line the Meta Agent sees when describing what
  your domain contributes. Write it like a dashboard section title.

## Step 2 — Write your Domain Agent

An agent is just a function from your input (plus history) to a
`DomainInsight`. Rules first — no LLM, no API key, fully deterministic:

```ts
import { createAgent } from 'cql-native-ai';

interface TicketInput {
  openCount: number;
  oldestAgeHours: number;
  vipWaiting: boolean;
}

const ticketAgent = createAgent<TicketInput>(ticketDomain, (input) => ({
  domain: 'tickets',
  status:
    input.vipWaiting || input.oldestAgeHours > 24 ? 'warning' : 'good',
  headline: `${input.openCount} open, oldest ${input.oldestAgeHours}h`,
  detail: input.vipWaiting
    ? 'A VIP customer is waiting in the queue.'
    : input.oldestAgeHours > 24
      ? 'Oldest ticket has breached the 24h SLA window.'
      : 'Queue is within SLA.',
  recommendation:
    input.vipWaiting || input.oldestAgeHours > 24
      ? 'Assign the two oldest tickets before standup'
      : 'No action needed',
  confidence: 0.95,
  rawData: input,
}));
```

The return shape (`status` / `headline` / `detail` / `recommendation` /
`confidence`) is the `DomainInsight` interface — it's runtime-validated,
so a malformed insight throws immediately instead of corrupting downstream
synthesis.

## Step 3 — Register it

```ts
import { DomainRegistry } from 'cql-native-ai';

const registry = new DomainRegistry().register(ticketAgent);
```

**This one line is the entire extensibility story.** Classifier prompts
(`registry.buildClassifierPrompt()`), keyword inference, and the Meta
Agent all read from the registry — nothing else needs to change when you
add a domain.

## Step 4 — Run it standalone

```ts
const insight = await ticketAgent.analyze({
  openCount: 14,
  oldestAgeHours: 30,
  vipWaiting: false,
});
console.log(insight);
```

Output:

```
{
  domain: 'tickets',
  status: 'warning',
  headline: '14 open, oldest 30h',
  detail: 'Oldest ticket has breached the 24h SLA window.',
  recommendation: 'Assign the two oldest tickets before standup',
  confidence: 0.95,
  rawData: { openCount: 14, oldestAgeHours: 30, vipWaiting: false },
  timestamp: '2026-07-08T01:18:52.657Z'
}
```

## Step 5 — Add a second domain + Meta AI

Register one more small agent, then let the Meta Agent synthesize across
both:

```ts
import { MetaAgent } from 'cql-native-ai';

interface DeployInput { failedLastWeek: number; pendingReleases: number }

const deployAgent = createAgent<DeployInput>(
  {
    id: 'deploys',
    name: 'Deployments',
    description: 'Release pipeline health',
    metaSummaryTemplate: 'Delivery health: release cadence and failures',
  },
  (input) => ({
    domain: 'deploys',
    status: input.failedLastWeek > 1 ? 'warning' : 'good',
    headline: `${input.failedLastWeek} failed deploys last week`,
    detail: `${input.pendingReleases} releases pending.`,
    recommendation:
      input.failedLastWeek > 1
        ? 'Freeze non-critical releases and run a pipeline audit'
        : 'Keep shipping',
    confidence: 0.9,
    rawData: input,
  }),
);

registry.register(deployAgent); // ← again: one line, nothing else changes

const meta = new MetaAgent(registry);
const unified = await meta.run({
  inputs: {
    tickets: { openCount: 14, oldestAgeHours: 30, vipWaiting: false },
    deploys: { failedLastWeek: 3, pendingReleases: 5 },
  },
});
console.log(unified.insight);
console.log('warnings:', unified.warningDomains);
```

Output:

```
Attention needed: tickets (14 open, oldest 30h), deploys (3 failed deploys last week). Recommended action: Assign the two oldest tickets before standup
warnings: [ 'tickets', 'deploys' ]
```

Every contributing `DomainInsight` is preserved in
`unified.contributing` — synthesis never silently drops a domain.

## Step 6 (optional) — Swap in an LLM

Same domain, same interface — only the analysis implementation changes.
Note the `fallback`: if the LLM call fails (no key, network down, bad
output), you still get a valid, deterministic insight.

```ts
import { createLLMAgent, groqProvider } from 'cql-native-ai';

const llmTicketAgent = createLLMAgent<TicketInput>({
  domain: ticketDomain,
  provider: groqProvider(process.env.GROQ_API_KEY ?? 'missing-key'),
  fallback: (input) => ({
    domain: 'tickets',
    status: input.oldestAgeHours > 24 ? 'warning' : 'good',
    headline: 'rule-based fallback',
    detail: 'LLM unavailable; using SLA rules.',
    recommendation: 'Assign oldest tickets first',
    confidence: 0.6,
    rawData: input,
  }),
});

const llmInsight = await llmTicketAgent.analyze({
  openCount: 14,
  oldestAgeHours: 30,
  vipWaiting: false,
});
console.log(llmInsight);
```

Run **without** a `GROQ_API_KEY`, this prints the fallback insight
(`headline: 'rule-based fallback'`, `confidence: 0.6`) — your pipeline
degrades gracefully instead of crashing. With a real key, the LLM's
analysis replaces it, and the calling code doesn't change at all.

Any OpenAI-compatible endpoint works the same way (OpenAI, Ollama, vLLM)
via `OpenAICompatProvider`.

## What you just built

*(Optional reading — the category-theory view.)* Your two agents are
**Functors** `F_tickets` and `F_deploys` from their domain categories into
the shared `DomainInsight` codomain. Sharing that codomain is what makes
their outputs composable — it's the component of a **Natural
Transformation**, which is why the Meta Agent could consume both without
any adapter code. The Meta Agent itself computes a **Lax Colimit**: a
synthesis that provably keeps every domain's contribution
(`unified.contributing`).

## Next steps

- A larger worked example (4 domains, HR ⇒ Engineering natural
  transformation, live extensibility): [`examples/company-network.ts`](../examples/company-network.ts)
- Measuring order-dependence in LLM-backed pipelines:
  `checkNaturality()` in the [README](../README.md#natural-transformations-cross-domain-communication)
- Questions or ideas → [open an issue](https://github.com/DongGyuJU/cql-native-ai/issues)
