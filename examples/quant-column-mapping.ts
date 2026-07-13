// examples/quant-column-mapping.ts
//
// Ride the Whale (KOSPI 퀀트)의 실제 col_map을 SchemaMapping으로 옮겨,
// 손으로 짠 리네임 딕셔너리가 못 잡는 오류를 잡아낸다.
//
// 실제 코드 (features/earnings.py):
//     col_map = {
//         "earn_yoy":     "op_yoy",
//         "earn_accel":   "op_accel",
//         "earn_qoq":     "op_qoq",
//         "earn_rev_yoy": "rev_yoy",
//     }
// 이 딕셔너리에 오타가 나면 pandas는 조용히 NaN 컬럼을 만든다 — 에러가 아니라.

import { DomainSchema, InstanceBuilder, checkInstanceIsFunctor } from '../src/schema';
import { SchemaMapping, checkSchemaMappingLaws, deltaF } from '../src/schemaMapping';

const earningsSchema: DomainSchema = {
  objects: {
    EarningsRecord: {
      attributes: [
        { name: 'op_yoy', type: 'number' },
        { name: 'op_accel', type: 'number' },
        { name: 'rev_yoy', type: 'number' },
        { name: 'fiscal_quarter', type: 'string' },
      ],
    },
  },
  morphisms: [],
};

const panelSchema: DomainSchema = {
  objects: {
    PanelRow: {
      attributes: [
        { name: 'earn_yoy', type: 'number' },
        { name: 'earn_accel', type: 'number' },   // t=+6.46, 가장 강한 신호
        { name: 'earn_rev_yoy', type: 'number' }, // t=-7.75
      ],
    },
  },
  morphisms: [],
};

const earnings = new InstanceBuilder()
  .addRow('EarningsRecord', { id: '005930_2025Q1', op_yoy: 0.12, op_accel: 0.034, rev_yoy: 0.08, fiscal_quarter: '2025Q1' })
  .addRow('EarningsRecord', { id: '000660_2025Q1', op_yoy: -0.05, op_accel: -0.011, rev_yoy: 0.02, fiscal_quarter: '2025Q1' })
  .build();

console.log('=== 1. 올바른 col_map ===');
const F: SchemaMapping = {
  onObjects: { PanelRow: 'EarningsRecord' },
  onMorphisms: {},
  onAttributes: {
    PanelRow: { earn_yoy: 'op_yoy', earn_accel: 'op_accel', earn_rev_yoy: 'rev_yoy' },
  },
};
console.log('valid:', checkSchemaMappingLaws(F, panelSchema, earningsSchema).isFunctor);
const panel = deltaF(F, earnings, panelSchema);
console.log('이관된 panel rows:', panel.rows.PanelRow);
console.log('결과 자체도 유효한가:', checkInstanceIsFunctor(panelSchema, panel).isFunctor);

console.log('\n=== 2. 오타: op_accel -> op_accell ===');
const typo: SchemaMapping = {
  ...F,
  onAttributes: {
    PanelRow: { earn_yoy: 'op_yoy', earn_accel: 'op_accell', earn_rev_yoy: 'rev_yoy' },
  },
};
const typoReport = checkSchemaMappingLaws(typo, panelSchema, earningsSchema);
console.log('valid:', typoReport.isFunctor);
for (const v of typoReport.violations) console.log(`  [${v.reason}] ${v.subject}: ${v.detail}`);
console.log('  → pandas였다면: earn_accel 컬럼이 통째로 NaN. 에러 없음. 모델은 그냥 학습됨.');

console.log('\n=== 3. 누락: earn_rev_yoy(t=-7.75)를 깜빡함 ===');
const missing: SchemaMapping = {
  ...F,
  onAttributes: { PanelRow: { earn_yoy: 'op_yoy', earn_accel: 'op_accel' } },
};
const missingReport = checkSchemaMappingLaws(missing, panelSchema, earningsSchema);
console.log('valid:', missingReport.isFunctor);
for (const v of missingReport.violations) console.log(`  [${v.reason}] ${v.subject}`);
console.log('  → pandas였다면: 강한 신호 하나가 조용히 사라짐. 아무도 모름.');
