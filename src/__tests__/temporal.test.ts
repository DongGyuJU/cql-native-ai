// src/__tests__/temporal.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '../agent';
import { DomainRegistry } from '../registry';
import { MetaAgent } from '../meta';
import { TemporalRunner } from '../temporal';
import { DomainInsight, AnalyzeOptions } from '../types';

// ── helpers ──────────────────────────────────────────────────────

function speedAgent(id: string, upstream?: string) {
  return createAgent<{ speed: number }>(
    { id, name: id },
    (input, _history, options?: AnalyzeOptions) => {
      let speed = input.speed;
      // React to the UPSTREAM node's PREVIOUS-tick insight — the exact
      // pattern all four demos hand-rolled, now via options.temporal.
      if (upstream && options?.temporal) {
        const prev = options.temporal.previousInsight(upstream);
        if (prev && prev.status === 'warning') speed = Math.min(speed, 15);
      }
      return {
        domain: id,
        status: speed < 20 ? 'warning' : 'good',
        headline: `${speed}km/h`,
        detail: speed < 20 ? 'congested' : 'ok',
        recommendation: 'n/a',
        confidence: 1,
        rawData: { speed },
      } as DomainInsight;
    },
  );
}

function chainRunner(n: number) {
  // node0 -> node1 -> ... -> node(n-1), each reacting to its predecessor
  const registry = new DomainRegistry();
  for (let i = 0; i < n; i++) {
    registry.register(speedAgent(`node${i}`, i > 0 ? `node${i - 1}` : undefined));
  }
  return new TemporalRunner(new MetaAgent(registry));
}

function freeInputs(n: number): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) inputs[`node${i}`] = { speed: 60 };
  return inputs;
}

// ── snapshot rule ────────────────────────────────────────────────

test('tick 0: previousInput/previousInsight are undefined (no fabricated history)', async () => {
  const registry = new DomainRegistry();
  let seen: unknown = 'not-called';
  registry.register(createAgent({ id: 'a', name: 'a' }, (input, _h, opt?: AnalyzeOptions) => {
    seen = opt?.temporal?.previousInsight('a');
    return { domain: 'a', status: 'good', headline: 'x', detail: 'x', recommendation: 'x', confidence: 1 };
  }));
  const runner = new TemporalRunner(new MetaAgent(registry));
  await runner.step({ a: {} });
  assert.equal(seen, undefined);
});

test('tick t reads exactly tick t-1, not tick t (one-hop delay by construction)', async () => {
  const runner = chainRunner(2);
  const inputs = freeInputs(2);

  // t0: incident at node0
  (inputs.node0 as { speed: number }).speed = 10;
  const r0 = await runner.step(inputs);
  // node0 is warning immediately; node1 must NOT react yet (it can only
  // see tick -1, which doesn't exist)
  assert.ok(r0.warningDomains.includes('node0'));
  assert.ok(!r0.warningDomains.includes('node1'));

  // t1: node1 now sees node0's tick-0 warning and reacts
  const r1 = await runner.step(inputs);
  assert.ok(r1.warningDomains.includes('node1'));
});

test('the frozen snapshot is immutable: same tick, every agent sees identical previous state', async () => {
  // Two agents both read node0's previous insight; they must agree even
  // though they are evaluated at different moments within the tick.
  const registry = new DomainRegistry();
  const observed: Record<string, string | undefined> = {};
  registry.register(speedAgent('node0'));
  for (const id of ['obsA', 'obsB']) {
    registry.register(createAgent({ id, name: id }, (_i, _h, opt?: AnalyzeOptions) => {
      observed[id] = opt?.temporal?.previousInsight('node0')?.status;
      return { domain: id, status: 'good', headline: 'x', detail: 'x', recommendation: 'x', confidence: 1 };
    }));
  }
  const runner = new TemporalRunner(new MetaAgent(registry));
  await runner.step({ node0: { speed: 10 }, obsA: {}, obsB: {} }); // t0: node0 warning
  await runner.step({ node0: { speed: 60 }, obsA: {}, obsB: {} }); // t1: both observers read t0
  assert.equal(observed.obsA, 'warning');
  assert.equal(observed.obsB, 'warning');
});

// ── order invariance across the time axis ────────────────────────

test('registration order does not change temporal results (order invariance extends across ticks)', async () => {
  async function runWithOrder(reversed: boolean): Promise<string[][]> {
    const registry = new DomainRegistry();
    const ids = [0, 1, 2, 3].map((i) => i);
    const order = reversed ? [...ids].reverse() : ids;
    // register in the given order; upstream wiring is identical
    for (const i of order) {
      registry.register(speedAgent(`node${i}`, i > 0 ? `node${i - 1}` : undefined));
    }
    const runner = new TemporalRunner(new MetaAgent(registry));
    const inputs = freeInputs(4);
    (inputs.node0 as { speed: number }).speed = 10;
    const warningsPerTick: string[][] = [];
    for (let t = 0; t < 5; t++) {
      const r = await runner.step(inputs);
      warningsPerTick.push([...r.warningDomains].sort());
    }
    return warningsPerTick;
  }
  const forward = await runWithOrder(false);
  const backward = await runWithOrder(true);
  assert.deepEqual(forward, backward);
});

// ── distance-delay correspondence (Limitation 4 -> feature) ──────

test('propagation arrives at graph distance exactly: first-warning tick == d(v,u), 1 tick/hop', async () => {
  const N = 6;
  const runner = chainRunner(N);
  const inputs = freeInputs(N);
  (inputs.node0 as { speed: number }).speed = 10; // persistent incident at node0

  const firstWarningTick: Record<string, number> = {};
  for (let t = 0; t < N + 2; t++) {
    const r = await runner.step(inputs);
    for (const d of r.warningDomains) {
      if (firstWarningTick[d] === undefined) firstWarningTick[d] = t;
    }
  }
  // node i is at graph distance i from node0 -> first warning at tick i
  for (let i = 0; i < N; i++) {
    assert.equal(firstWarningTick[`node${i}`], i,
      `node${i} should first warn at tick ${i} (graph distance), got ${firstWarningTick[`node${i}`]}`);
  }
});

// ── per-domain history ───────────────────────────────────────────

test('each domain receives its OWN bounded history, not a shared global list', async () => {
  const registry = new DomainRegistry();
  const seenLengths: Record<string, number> = {};
  const seenLast: Record<string, unknown> = {};
  for (const id of ['x', 'y']) {
    registry.register(createAgent({ id, name: id }, (_i, history) => {
      seenLengths[id] = history.length;
      seenLast[id] = history.length ? history[history.length - 1].data : undefined;
      return { domain: id, status: 'good', headline: 'x', detail: 'x', recommendation: 'x', confidence: 1 };
    }));
  }
  const runner = new TemporalRunner(new MetaAgent(registry), { historyDepth: 3 });
  for (let t = 0; t < 5; t++) {
    await runner.step({ x: { v: `x${t}` }, y: { v: `y${t}` } });
  }
  // On the 5th step (t=4), each agent sees its own last-3 entries (depth 3),
  // and the most recent entry is its OWN t=3 input, not the other domain's.
  assert.equal(seenLengths.x, 3);
  assert.equal(seenLengths.y, 3);
  assert.deepEqual(seenLast.x, { v: 'x3' });
  assert.deepEqual(seenLast.y, { v: 'y3' });
  // runner-side accessor agrees and is bounded
  assert.equal(runner.historyOf('x').length, 3);
});

test('reset() returns to tick 0 with no history and no snapshot', async () => {
  const runner = chainRunner(2);
  await runner.step(freeInputs(2));
  await runner.step(freeInputs(2));
  assert.equal(runner.tick, 2);
  runner.reset();
  assert.equal(runner.tick, 0);
  assert.equal(runner.historyOf('node0').length, 0);
  // after reset, tick 0 must again have no previous snapshot
  const registry = new DomainRegistry();
  let prev: unknown = 'x';
  registry.register(createAgent({ id: 'p', name: 'p' }, (_i, _h, opt?: AnalyzeOptions) => {
    prev = opt?.temporal?.previousInsight('p');
    return { domain: 'p', status: 'good', headline: 'x', detail: 'x', recommendation: 'x', confidence: 1 };
  }));
  const r2 = new TemporalRunner(new MetaAgent(registry));
  await r2.step({ p: {} });
  r2.reset();
  await r2.step({ p: {} });
  assert.equal(prev, undefined);
});

// ── temporal cannot be spoofed via extraOptions ──────────────────

test('extraOptions cannot override the runner-provided temporal snapshot', async () => {
  const registry = new DomainRegistry();
  let tickSeen = -1;
  registry.register(createAgent({ id: 'a', name: 'a' }, (_i, _h, opt?: AnalyzeOptions) => {
    tickSeen = opt?.temporal?.tick ?? -1;
    return { domain: 'a', status: 'good', headline: 'x', detail: 'x', recommendation: 'x', confidence: 1 };
  }));
  const runner = new TemporalRunner(new MetaAgent(registry));
  const fakeTemporal = { tick: 999, previousInput: () => 'fake', previousInsight: () => undefined };
  await runner.step({ a: {} }, () => ({ temporal: fakeTemporal as never }));
  assert.equal(tickSeen, 0, 'runner must overwrite any caller-supplied temporal');
});
