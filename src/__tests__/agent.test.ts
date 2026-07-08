// src/__tests__/agent.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '../agent';
import { InsightValidationError } from '../validate';

test('DomainAgent.analyze returns a value satisfying the DomainInsight interface', async () => {
  const agent = createAgent<{ x: number }>(
    { id: 'demo', name: 'Demo' },
    (input) => ({
      domain: 'demo',
      status: input.x > 5 ? 'warning' : 'good',
      headline: `x=${input.x}`,
      detail: 'detail',
      recommendation: 'recommendation',
      confidence: 0.8,
    }),
  );

  const insight = await agent.analyze({ x: 10 });
  assert.equal(insight.domain, 'demo');
  assert.equal(insight.status, 'warning');
  assert.ok(insight.timestamp, 'timestamp should be auto-filled');
});

test('DomainAgent throws InsightValidationError when the user function returns a malformed insight', async () => {
  const badAgent = createAgent<{}>(
    { id: 'broken', name: 'Broken' },
    () =>
      ({
        domain: 'broken',
        status: 'not-a-real-status', // invalid on purpose
        headline: 'x',
        detail: 'x',
        recommendation: 'x',
        confidence: 0.5,
      }) as any,
  );

  await assert.rejects(() => badAgent.analyze({}), InsightValidationError);
});

test('DomainAgent throws when domain.id is missing', () => {
  assert.throws(() =>
    createAgent({ id: '', name: 'no id' } as any, () => ({} as any)),
  );
});

test('DomainAgent.analyze forwards history and options to the underlying function', async () => {
  let seenHistoryLen = -1;
  let seenContextLen = -1;

  const agent = createAgent<{}>({ id: 'probe', name: 'Probe' }, (_input, history, options) => {
    seenHistoryLen = history.length;
    seenContextLen = options.context?.length ?? 0;
    return {
      domain: 'probe',
      status: 'info',
      headline: 'ok',
      detail: '',
      recommendation: '',
      confidence: 1,
    };
  });

  await agent.analyze(
    {},
    [{ timestamp: new Date().toISOString(), data: { a: 1 } }],
    {
      context: [
        {
          domain: 'other',
          status: 'good',
          headline: '',
          detail: '',
          recommendation: '',
          confidence: 1,
        },
      ],
    },
  );

  assert.equal(seenHistoryLen, 1);
  assert.equal(seenContextLen, 1);
});
