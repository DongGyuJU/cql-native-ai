// browser-entry.ts
// Browser-facing entry point for the supply-chain demo. Exposes ONLY
// the rule-based, dependency-free parts of cql-native-ai — no LLM
// providers (those need fetch/API keys and are irrelevant to a
// deterministic visualization). What the demo imports here is the
// actual library code, compiled by tsc/esbuild, not a reimplementation.

export { createAgent, DomainAgent } from './src/agent';
export { DomainRegistry } from './src/registry';
export { MetaAgent } from './src/meta';
export { NaturalTransformation } from './src/transform';
export type { DomainInsight, UnifiedInsight, DomainDefinition } from './src/types';
