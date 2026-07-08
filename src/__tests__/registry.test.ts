// src/__tests__/registry.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '../agent';
import { DomainRegistry } from '../registry';

function makeAgent(id: string, keywords: string[] = []) {
  return createAgent<{}>(
    { id, name: id, description: `${id} domain`, keywords, active: true },
    () => ({
      domain: id,
      status: 'good',
      headline: '',
      detail: '',
      recommendation: '',
      confidence: 1,
    }),
  );
}

test('Registry.register / list roundtrip', () => {
  const registry = new DomainRegistry();
  registry.register(makeAgent('a')).register(makeAgent('b'));
  assert.deepEqual(
    registry.list().map((a) => a.domain.id).sort(),
    ['a', 'b'],
  );
});

test('Extensibility (Proposition 2): adding a domain does not require touching existing ones', () => {
  const registry = new DomainRegistry();
  registry.register(makeAgent('hr')).register(makeAgent('engineering'));
  assert.equal(registry.list().length, 2);

  // simulate "later, someone adds a new domain"
  registry.register(makeAgent('sales'));
  assert.equal(registry.list().length, 3);
  assert.ok(registry.has('sales'));

  // existing domains are untouched
  assert.ok(registry.has('hr'));
  assert.ok(registry.has('engineering'));
});

test('inactive domains are excluded from list() but still retrievable by id', () => {
  const registry = new DomainRegistry();
  const inactive = createAgent<{}>(
    { id: 'disabled', name: 'disabled', active: false },
    () => ({
      domain: 'disabled',
      status: 'good',
      headline: '',
      detail: '',
      recommendation: '',
      confidence: 1,
    }),
  );
  registry.register(inactive);
  assert.equal(registry.list().length, 0);
  assert.ok(registry.get('disabled'), 'get() should still find inactive domains');
});

test('inferDomains matches free text against registered keywords', () => {
  const registry = new DomainRegistry();
  registry.register(makeAgent('caffeine', ['coffee', 'americano', 'latte']));
  registry.register(makeAgent('sleep', ['sleep', 'nap', 'bedtime']));

  const matches = registry.inferDomains('I just had an iced americano');
  assert.deepEqual(matches.map((d) => d.id), ['caffeine']);

  const none = registry.inferDomains('random unrelated text');
  assert.equal(none.length, 0);
});

test('buildClassifierPrompt and buildMetaContext include every active domain', () => {
  const registry = new DomainRegistry();
  registry.register(makeAgent('caffeine', ['coffee']));
  registry.register(makeAgent('sleep', ['nap']));

  const prompt = registry.buildClassifierPrompt();
  assert.match(prompt, /caffeine/);
  assert.match(prompt, /sleep/);

  const ctx = registry.buildMetaContext();
  assert.match(ctx, /caffeine/);
  assert.match(ctx, /sleep/);
});

test('unregister removes a domain', () => {
  const registry = new DomainRegistry();
  registry.register(makeAgent('temp'));
  assert.ok(registry.has('temp'));
  registry.unregister('temp');
  assert.ok(!registry.has('temp'));
});
