// src/__tests__/transform.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '../agent';
import { NaturalTransformation } from '../transform';

test('NaturalTransformation.apply delivers the source insight as context to the target agent', async () => {
  const source = createAgent<{ x: number }>({ id: 'src', name: 'Source' }, (i) => ({
    domain: 'src',
    status: i.x > 5 ? 'warning' : 'good',
    headline: `x=${i.x}`,
    detail: '',
    recommendation: '',
    confidence: 1,
  }));

  let receivedContextDomains: string[] = [];
  const target = createAgent<{ y: number }>({ id: 'tgt', name: 'Target' }, (i, _h, opts) => {
    receivedContextDomains = (opts.context ?? []).map((c) => c.domain);
    return {
      domain: 'tgt',
      status: 'info',
      headline: `y=${i.y}`,
      detail: '',
      recommendation: '',
      confidence: 1,
    };
  });

  const nt = new NaturalTransformation(source, target, {
    translateInput: (i: { x: number }) => ({ y: i.x * 2 }),
  });

  const result = await nt.apply({ x: 7 });
  assert.equal(result.sourceInsight.domain, 'src');
  assert.equal(result.targetInsight.headline, 'y=14');
  assert.deepEqual(receivedContextDomains, ['src']);
});

test('checkNaturality reports consistent=true when the target agent ignores order (pure function of translated input)', async () => {
  const source = createAgent<{ x: number }>({ id: 'src', name: 'Source' }, (i) => ({
    domain: 'src',
    status: 'good',
    headline: `x=${i.x}`,
    detail: '',
    recommendation: '',
    confidence: 1,
  }));

  // deterministic target: depends only on its own input, not on context
  const target = createAgent<{ y: number }>({ id: 'tgt', name: 'Target' }, (i) => ({
    domain: 'tgt',
    status: i.y > 10 ? 'warning' : 'good',
    headline: `y=${i.y}`,
    detail: '',
    recommendation: '',
    confidence: 1,
  }));

  const nt = new NaturalTransformation(source, target, {
    translateInput: (i: { x: number }) => ({ y: i.x }),
  });

  const report = await nt.checkNaturality([{ x: 3 }, { x: 3 }]);
  assert.equal(report.consistent, true);
  assert.equal(report.details.statusMatch, true);
});

test('checkNaturality can detect order-dependence when the target agent uses context non-trivially', async () => {
  const source = createAgent<{ x: number }>({ id: 'src', name: 'Source' }, (i) => ({
    domain: 'src',
    status: 'good',
    headline: `x=${i.x}`,
    detail: '',
    recommendation: '',
    confidence: 1,
  }));

  // adversarial target: status flips depending on how much context it received
  const target = createAgent<{ y: number }>({ id: 'tgt', name: 'Target' }, (i, _h, opts) => ({
    domain: 'tgt',
    status: (opts.context?.length ?? 0) > 1 ? 'warning' : 'good',
    headline: `y=${i.y} ctx=${opts.context?.length ?? 0}`,
    detail: '',
    recommendation: '',
    confidence: 1,
  }));

  const nt = new NaturalTransformation(source, target, {
    translateInput: (i: { x: number }) => ({ y: i.x }),
  });

  const report = await nt.checkNaturality([{ x: 1 }, { x: 2 }]);
  // forward path uses 1 context item, reversed path uses 2 -> status differs
  assert.equal(report.details.statusMatch, false);
  assert.equal(report.consistent, false);
});
