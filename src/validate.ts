// src/validate.ts
// Runtime validation of DomainInsight.
//
// The type system enforces the Natural Transformation interface at
// compile time; this module enforces it at runtime (important when
// insights come back from an LLM as parsed JSON).

import { DomainInsight, InsightStatus } from './types';

const STATUSES: InsightStatus[] = ['good', 'warning', 'info', 'error'];

export class InsightValidationError extends Error {
  constructor(message: string, public readonly value: unknown) {
    super(`[cql-native-ai] invalid DomainInsight: ${message}`);
  }
}

/**
 * Validates that a value satisfies the DomainInsight interface.
 * Throws InsightValidationError if not.
 *
 * @param expectedDomain if given, insight.domain must match
 */
export function validateInsight(
  value: unknown,
  expectedDomain?: string,
): asserts value is DomainInsight {
  if (typeof value !== 'object' || value === null) {
    throw new InsightValidationError('not an object', value);
  }
  const v = value as Record<string, unknown>;

  if (typeof v.domain !== 'string' || v.domain.length === 0) {
    throw new InsightValidationError('missing "domain"', value);
  }
  if (expectedDomain && v.domain !== expectedDomain) {
    throw new InsightValidationError(
      `domain mismatch: expected "${expectedDomain}", got "${v.domain}"`,
      value,
    );
  }
  if (!STATUSES.includes(v.status as InsightStatus)) {
    throw new InsightValidationError(
      `"status" must be one of ${STATUSES.join('|')}`,
      value,
    );
  }
  for (const key of ['headline', 'detail', 'recommendation'] as const) {
    if (typeof v[key] !== 'string') {
      throw new InsightValidationError(`missing string field "${key}"`, value);
    }
  }
  const c = v.confidence;
  if (typeof c !== 'number' || Number.isNaN(c) || c < 0 || c > 1) {
    throw new InsightValidationError('"confidence" must be a number in [0,1]', value);
  }
}

/** Non-throwing variant. */
export function isValidInsight(value: unknown, expectedDomain?: string): boolean {
  try {
    validateInsight(value, expectedDomain);
    return true;
  } catch {
    return false;
  }
}

/**
 * Coerce a partially-valid LLM output into a valid DomainInsight,
 * filling missing fields with safe defaults. Use as a last resort
 * after JSON parsing.
 */
export function coerceInsight(
  value: Record<string, unknown>,
  domain: string,
): DomainInsight {
  const status = STATUSES.includes(value.status as InsightStatus)
    ? (value.status as InsightStatus)
    : 'info';
  const num = Number(value.confidence);
  return {
    domain,
    status,
    headline: String(value.headline ?? '').slice(0, 120) || 'no headline',
    detail: String(value.detail ?? ''),
    recommendation: String(value.recommendation ?? ''),
    confidence: Number.isFinite(num) ? Math.min(Math.max(num, 0), 1) : 0.5,
    rawData: value.rawData,
    timestamp: new Date().toISOString(),
  };
}
