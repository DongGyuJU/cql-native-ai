// examples/company-network.ts
// CQL Native AI applied to a COMPANY NETWORK — proving the framework
// is domain-agnostic. Three departments become three Domain Categories;
// HR ↔ Engineering communicate via a Natural Transformation; the CEO
// dashboard is the Meta Agent (lax colimit).
//
// Run:  npx ts-node examples/company-network.ts
// (No LLM needed — agents here are rule-based. Swap createAgent for
//  createLLMAgent + groqProvider(...) to make them LLM-backed.)

import {
  createAgent,
  DomainRegistry,
  MetaAgent,
  NaturalTransformation,
} from '../src';

// ── 1. Domain Categories (Objects + Morphisms) ──────────────────

const hrDomain = {
  id: 'hr',
  name: 'Human Resources',
  description: 'Headcount, attrition, hiring pipeline',
  keywords: ['hire', 'attrition', 'headcount', 'recruiting'],
  schema: {
    Employee: 'id, team, tenure, satisfaction',
    Attrition: 'monthly leaver count',
    Pipeline: 'open roles, candidates',
  },
  relations: [
    { from: 'Attrition', to: 'Pipeline', label: 'creates demand' },
    { from: 'Employee', to: 'Attrition', label: 'low satisfaction increases' },
  ],
  metaSummaryTemplate: 'People health: attrition risk and hiring status',
};

const engDomain = {
  id: 'engineering',
  name: 'Engineering',
  description: 'Velocity, incidents, on-call load',
  keywords: ['deploy', 'incident', 'velocity', 'sprint'],
  schema: {
    Sprint: 'planned vs completed points',
    Incident: 'severity, MTTR',
    OnCall: 'pages per engineer per week',
  },
  relations: [
    { from: 'OnCall', to: 'Sprint', label: 'reduces capacity' },
    { from: 'Incident', to: 'OnCall', label: 'generates pages' },
  ],
  metaSummaryTemplate: 'Delivery health: velocity and operational load',
};

const financeDomain = {
  id: 'finance',
  name: 'Finance',
  description: 'Burn rate, runway',
  keywords: ['burn', 'runway', 'budget'],
  schema: { Burn: 'monthly spend', Runway: 'months remaining' },
  relations: [{ from: 'Burn', to: 'Runway', label: 'depletes' }],
  metaSummaryTemplate: 'Financial health: burn and runway',
};

// ── 2. Domain Agents (Functors) — rule-based here ───────────────

interface HRInput { attritionRate: number; openRoles: number; avgSatisfaction: number }
const hrAgent = createAgent<HRInput>(hrDomain, (input) => ({
  domain: 'hr',
  status: input.attritionRate > 0.15 ? 'warning' : 'good',
  headline: `attrition ${(input.attritionRate * 100).toFixed(0)}%, ${input.openRoles} open roles`,
  detail: `Average satisfaction ${input.avgSatisfaction}/5. ${
    input.attritionRate > 0.15
      ? 'Attrition above 15% threshold — replacement cost mounting.'
      : 'Attrition within healthy range.'
  }`,
  recommendation:
    input.attritionRate > 0.15
      ? 'Run stay-interviews with the two lowest-satisfaction teams this week'
      : 'Maintain current engagement programs',
  confidence: 0.9,
  rawData: input,
}));

interface EngInput { velocityRatio: number; sev1Incidents: number; pagesPerEngineer: number }
const engAgent = createAgent<EngInput>(engDomain, (input, _hist, options) => {
  // Natural Transformation delivers HR context here:
  const hrContext = options.context?.find((c) => c.domain === 'hr');
  const attritionNote =
    hrContext?.status === 'warning'
      ? ' HR attrition warning suggests velocity drop may be people-driven, not process-driven.'
      : '';
  return {
    domain: 'engineering',
    status:
      input.velocityRatio < 0.7 || input.sev1Incidents > 2 ? 'warning' : 'good',
    headline: `velocity ${(input.velocityRatio * 100).toFixed(0)}%, ${input.sev1Incidents} sev-1`,
    detail:
      `Completed ${(input.velocityRatio * 100).toFixed(0)}% of planned points; ` +
      `${input.pagesPerEngineer} pages/engineer/week.` +
      attritionNote,
    recommendation:
      input.pagesPerEngineer > 5
        ? 'Rotate on-call and dedicate next sprint to incident root causes'
        : 'Keep current sprint scope',
    confidence: 0.85,
    rawData: input,
  };
});

interface FinInput { monthlyBurn: number; runwayMonths: number }
const finAgent = createAgent<FinInput>(financeDomain, (input) => ({
  domain: 'finance',
  status: input.runwayMonths < 12 ? 'warning' : 'good',
  headline: `runway ${input.runwayMonths} months`,
  detail: `Monthly burn $${(input.monthlyBurn / 1000).toFixed(0)}k.`,
  recommendation:
    input.runwayMonths < 12
      ? 'Start fundraise prep or cut burn 15%'
      : 'No action needed',
  confidence: 1.0,
  rawData: input,
}));

// ── 3. Registry (Index Category) ────────────────────────────────

const registry = new DomainRegistry()
  .register(hrAgent)
  .register(engAgent)
  .register(finAgent);

// ── 4. Natural Transformation: HR ⇒ Engineering ─────────────────
// G translates HR data into engineering's input language.

const hrToEng = new NaturalTransformation(hrAgent, engAgent, {
  translateInput: (hr: HRInput): EngInput => ({
    // attrition reduces effective velocity; open roles raise on-call load
    velocityRatio: Math.max(0.3, 0.95 - hr.attritionRate * 1.5),
    sev1Incidents: 1,
    pagesPerEngineer: 3 + hr.openRoles * 0.5,
  }),
});

// ── 5. Meta Agent (Lax Colimit) — the CEO dashboard ─────────────

async function main() {
  const meta = new MetaAgent(registry); // TemplateSynthesizer by default

  console.log('=== η: HR ⇒ Engineering ===');
  const nt = await hrToEng.apply({
    attritionRate: 0.18,
    openRoles: 6,
    avgSatisfaction: 3.1,
  });
  console.log('HR insight     :', nt.sourceInsight.headline);
  console.log('Eng insight    :', nt.targetInsight.headline);
  console.log('Eng detail     :', nt.targetInsight.detail);

  console.log('\n=== F_meta: CEO dashboard ===');
  const unified = await meta.run({
    inputs: {
      hr: { attritionRate: 0.18, openRoles: 6, avgSatisfaction: 3.1 },
      engineering: { velocityRatio: 0.62, sev1Incidents: 3, pagesPerEngineer: 7 },
      finance: { monthlyBurn: 420_000, runwayMonths: 9 },
    },
  });
  console.log(unified.insight);
  console.log('warnings:', unified.warningDomains);

  // ── 6. Extensibility (Proposition 2) ──────────────────────────
  // Add a Sales domain: ONE register() call. Meta adapts automatically.
  const salesAgent = createAgent<{ pipeline: number; quotaAttainment: number }>(
    {
      id: 'sales',
      name: 'Sales',
      description: 'Pipeline and quota',
      metaSummaryTemplate: 'Revenue health: pipeline coverage',
    },
    (input) => ({
      domain: 'sales',
      status: input.quotaAttainment < 0.8 ? 'warning' : 'good',
      headline: `quota ${(input.quotaAttainment * 100).toFixed(0)}%`,
      detail: `Pipeline coverage ${input.pipeline}x.`,
      recommendation:
        input.quotaAttainment < 0.8 ? 'Review top-10 deals today' : 'Keep pace',
      confidence: 0.8,
      rawData: input,
    }),
  );
  registry.register(salesAgent);

  console.log('\n=== After registering "sales" (no other code changed) ===');
  const unified2 = await meta.run({
    inputs: {
      hr: { attritionRate: 0.18, openRoles: 6, avgSatisfaction: 3.1 },
      engineering: { velocityRatio: 0.62, sev1Incidents: 3, pagesPerEngineer: 7 },
      finance: { monthlyBurn: 420_000, runwayMonths: 9 },
      sales: { pipeline: 2.1, quotaAttainment: 0.72 },
    },
  });
  console.log(unified2.insight);
  console.log('domains analyzed:', unified2.contributing.map((c) => c.domain));
}

main().catch(console.error);
