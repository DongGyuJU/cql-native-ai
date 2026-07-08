// examples/http-server.ts
// The realistic "final destination": embedding cql-native-ai in a
// backend service. Your frontend / Slack bot / cron job talks to these
// routes; the library does the analysis.
//
// Run:   npx ts-node examples/http-server.ts
// Then:  curl -X POST localhost:3100/analyze/tickets \
//          -H 'Content-Type: application/json' \
//          -d '{"openCount":14,"oldestAgeHours":30,"vipWaiting":false}'
//
//        curl -X POST localhost:3100/meta \
//          -H 'Content-Type: application/json' \
//          -d '{"inputs":{"tickets":{"openCount":14,"oldestAgeHours":30,"vipWaiting":false},"deploys":{"failedLastWeek":3,"pendingReleases":5}}}'

import Fastify from 'fastify';
import { createAgent, DomainRegistry, MetaAgent } from '../src';

// ── Domains + agents (same ones built in docs/tutorial.md) ──────

interface TicketInput { openCount: number; oldestAgeHours: number; vipWaiting: boolean }

const ticketAgent = createAgent<TicketInput>(
  {
    id: 'tickets',
    name: 'Support Tickets',
    description: 'Incoming customer support ticket triage',
    keywords: ['ticket', 'refund', 'bug', 'complaint', 'support'],
    metaSummaryTemplate: 'Support health: queue pressure and SLA risk',
  },
  (input) => ({
    domain: 'tickets',
    status: input.vipWaiting || input.oldestAgeHours > 24 ? 'warning' : 'good',
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
  }),
);

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

const registry = new DomainRegistry().register(ticketAgent).register(deployAgent);
const meta = new MetaAgent(registry);

// ── HTTP layer ──────────────────────────────────────────────────

const app = Fastify({ logger: false });

// POST /analyze/:domainId — run one Domain Agent
app.post<{ Params: { domainId: string }; Body: unknown }>(
  '/analyze/:domainId',
  async (req, reply) => {
    const agent = registry.get(req.params.domainId);
    if (!agent) {
      reply.status(404);
      return {
        error: `unknown domain "${req.params.domainId}"`,
        available: registry.domains().map((d) => d.id),
      };
    }
    return agent.analyze(req.body);
  },
);

// POST /meta — run the Meta Agent (lax colimit) over all provided inputs
app.post<{ Body: { inputs: Record<string, unknown> } }>(
  '/meta',
  async (req, reply) => {
    if (!req.body?.inputs || typeof req.body.inputs !== 'object') {
      reply.status(400);
      return { error: 'body must be { "inputs": { "<domainId>": <input>, ... } }' };
    }
    return meta.run({ inputs: req.body.inputs });
  },
);

// GET /domains — discoverability: what can this server analyze?
app.get('/domains', async () => ({
  domains: registry.domains().map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
  })),
}));

const PORT = Number(process.env.PORT ?? 3100);
app.listen({ port: PORT, host: '0.0.0.0' }).then(() => {
  console.log(`cql-native-ai example server on http://localhost:${PORT}`);
  console.log(`domains: ${registry.domains().map((d) => d.id).join(', ')}`);
});
