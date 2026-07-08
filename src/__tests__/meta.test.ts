// src/__tests__/meta.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '../agent';
import { DomainRegistry } from '../registry';
import { MetaAgent } from '../meta';
import { errorInsight } from '../types';

test('MetaAgent.run preserves every contributing DomainInsight (no information loss)', async () => {
  const registry = new DomainRegistry();
  registry.register(
    createAgent<{ v: number }>({ id: 'a', name: 'A' }, (i) => ({
      domain: 'a',
      status: i.v > 5 ? 'warning' : 'good',
      headline: `a=${i.v}`,
      detail: '',
      recommendation: '',
      confidence: 1,
    })),
  );
  registry.register(
    createAgent<{ v: number }>({ id: 'b', name: 'B' }, (i) => ({
      domain: 'b',
      status: 'info',
      headline: `b=${i.v}`,
      detail: '',
      recommendation: '',
      confidence: 1,
    })),
  );

  const meta = new MetaAgent(registry);
  const unified = await meta.run({ inputs: { a: { v: 9 }, b: { v: 2 } } });

  assert.equal(unified.contributing.length, 2);
  assert.deepEqual(
    unified.contributing.map((c) => c.domain).sort(),
    ['a', 'b'],
  );
  assert.deepEqual(unified.warningDomains, ['a']);
});

test('MetaAgent.run only analyzes domains for which input was provided', async () => {
  const registry = new DomainRegistry();
  registry.register(
    createAgent<{}>({ id: 'a', name: 'A' }, () => ({
      domain: 'a',
      status: 'good',
      headline: '',
      detail: '',
      recommendation: '',
      confidence: 1,
    })),
  );
  registry.register(
    createAgent<{}>({ id: 'b', name: 'B' }, () => ({
      domain: 'b',
      status: 'good',
      headline: '',
      detail: '',
      recommendation: '',
      confidence: 1,
    })),
  );

  const meta = new MetaAgent(registry);
  const unified = await meta.run({ inputs: { a: {} } }); // 'b' has no input
  assert.deepEqual(unified.contributing.map((c) => c.domain), ['a']);
});

test('MetaAgent.run keeps the colimit total: a throwing agent becomes an error-insight instead of crashing the whole run', async () => {
  const registry = new DomainRegistry();
  registry.register(
    createAgent<{}>({ id: 'stable', name: 'Stable' }, () => ({
      domain: 'stable',
      status: 'good',
      headline: 'ok',
      detail: '',
      recommendation: '',
      confidence: 1,
    })),
  );
  registry.register(
    createAgent<{}>({ id: 'flaky', name: 'Flaky' }, () => {
      throw new Error('boom');
    }),
  );

  const meta = new MetaAgent(registry);
  const unified = await meta.run({ inputs: { stable: {}, flaky: {} } });

  assert.equal(unified.contributing.length, 2);
  const flaky = unified.contributing.find((c) => c.domain === 'flaky')!;
  assert.equal(flaky.status, 'error');
  assert.match(flaky.detail, /boom/);
});

test('errorInsight() produces a well-formed DomainInsight from an arbitrary thrown value', () => {
  const insight = errorInsight('x', 'plain string error');
  assert.equal(insight.domain, 'x');
  assert.equal(insight.status, 'error');
  assert.equal(insight.confidence, 0);
});
