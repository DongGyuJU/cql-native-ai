# Contributing to cql-native-ai

Thanks for your interest! This document covers the practical basics.

## Running tests

```bash
npm install
npm test          # builds test config + runs 24 unit tests (node --test)
npm run example   # smoke test: the company-network example must run clean
```

CI runs the same three steps on Node 18 and 20 for every PR — if they
pass locally, they'll pass in CI.

## Adding an example domain

1. Create `examples/<your-domain>.ts` (see
   [`examples/company-network.ts`](examples/company-network.ts) for the
   pattern: define domains → agents → registry → meta, then a `main()`
   that prints real output).
2. Keep it runnable **without any API key** — rule-based agents only, or
   an LLM agent with a deterministic `fallback`.
3. Verify it runs: `npx ts-node examples/<your-domain>.ts`.

## Adding an LLM provider

Implement the `LLMProvider` interface (one method) in
`src/providers/index.ts`:

```ts
export interface LLMProvider {
  complete(prompt: string, opts?: { temperature?: number; system?: string }): Promise<string>;
}
```

Most OpenAI-compatible endpoints need no new code — `OpenAICompatProvider`
already covers Groq, OpenAI, Ollama, and vLLM by changing `baseURL`. Only
add a dedicated provider class if the API shape is genuinely different
(and include a fallback-path test).

## Code style & constraints

- **The core stays zero-dependency.** `src/` (agent, registry, meta,
  transform, types, validate) must not import anything outside the Node
  standard library. LLM providers are the one exception — and they must
  remain optional and pluggable.
- No new runtime dependencies without prior discussion in an issue.
- Every exported function/class needs a test in `src/__tests__/`.
- TypeScript strict mode is on; keep it that way.
