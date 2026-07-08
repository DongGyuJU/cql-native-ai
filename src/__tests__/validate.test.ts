// src/__tests__/validate.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateInsight, isValidInsight, coerceInsight } from '../validate';

const valid = {
  domain: 'x',
  status: 'good' as const,
  headline: 'h',
  detail: 'd',
  recommendation: 'r',
  confidence: 0.5,
};

test('validateInsight accepts a well-formed insight', () => {
  assert.doesNotThrow(() => validateInsight(valid));
});

test('validateInsight enforces expectedDomain when provided', () => {
  assert.throws(() => validateInsight(valid, 'other-domain'));
  assert.doesNotThrow(() => validateInsight(valid, 'x'));
});

test('validateInsight rejects invalid status', () => {
  assert.throws(() => validateInsight({ ...valid, status: 'nope' }));
});

test('validateInsight rejects confidence outside [0,1]', () => {
  assert.throws(() => validateInsight({ ...valid, confidence: 1.5 }));
  assert.throws(() => validateInsight({ ...valid, confidence: -0.1 }));
});

test('isValidInsight never throws, returns boolean', () => {
  assert.equal(isValidInsight(valid), true);
  assert.equal(isValidInsight({}), false);
  assert.equal(isValidInsight(null), false);
});

test('coerceInsight fills missing fields with safe defaults', () => {
  const coerced = coerceInsight({ headline: 'partial' }, 'demo');
  assert.equal(coerced.domain, 'demo');
  assert.equal(coerced.status, 'info');
  assert.equal(coerced.headline, 'partial');
  assert.equal(coerced.confidence, 0.5);
  assert.doesNotThrow(() => validateInsight(coerced));
});

test('coerceInsight clamps out-of-range confidence into [0,1]', () => {
  const high = coerceInsight({ confidence: 5 }, 'd');
  const low = coerceInsight({ confidence: -3 }, 'd');
  assert.equal(high.confidence, 1);
  assert.equal(low.confidence, 0);
});
