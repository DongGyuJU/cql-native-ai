// examples/mapping-walkthrough.ts
//
// "매핑이란 무엇이고, 그룹마다 어떻게 다른가"를 두 개의 완전히 다른
// 도메인으로 나란히 보여준다. 형식(SchemaMapping의 모양)과 엔진
// (checkSchemaMappingLaws/deltaF)은 두 예제에서 완전히 동일하고,
// 내용(무엇이 무엇에 대응하는가)만 다르다.
//
// 실행:
//   TS_NODE_COMPILER_OPTIONS='{"esModuleInterop":true,"module":"commonjs","skipLibCheck":true}' \
//     npx ts-node examples/mapping-walkthrough.ts

import { DomainSchema, InstanceBuilder, checkInstanceIsFunctor } from '../src/schema';
import { SchemaMapping, checkSchemaMappingLaws, deltaF, withDerivedAttributes } from '../src/schemaMapping';

const line = (s: string) => console.log(`\n${'═'.repeat(64)}\n${s}\n${'═'.repeat(64)}`);

// ════════════════════════════════════════════════════════════════
// 예제 A — 인사팀 ↔ 급여팀 (같은 회사, 다른 어휘)
// ════════════════════════════════════════════════════════════════
line('예제 A — 인사팀 → 급여팀');

// 1단계: 두 그룹의 스키마 (각자 자기 어휘를 그대로 유지)
const hrSchema: DomainSchema = {
  objects: {
    Employee: { attributes: [{ name: 'name', type: 'string' }, { name: 'salary', type: 'number' }] },
    Department: { attributes: [{ name: 'name', type: 'string' }] },
  },
  morphisms: [{ name: 'worksIn', from: 'Employee', to: 'Department' }],
};
const payrollSchema: DomainSchema = {
  objects: {
    Worker: { attributes: [{ name: 'fullName', type: 'string' }, { name: 'monthlyPay', type: 'number' }] },
    CostCenter: { attributes: [{ name: 'label', type: 'string' }] },
  },
  morphisms: [{ name: 'billedTo', from: 'Worker', to: 'CostCenter' }],
};

// 2단계: 인사팀의 실제 데이터
const hrData = new InstanceBuilder()
  .addRow('Department', { id: 'eng', name: '개발팀' })
  .addRow('Department', { id: 'sales', name: '영업팀' })
  .addRow('Employee', { id: 'e1', name: '김디케이', salary: 5000 })
  .addRow('Employee', { id: 'e2', name: '이영희', salary: 4800 })
  .setFk('worksIn', 'e1', 'eng')
  .setFk('worksIn', 'e2', 'sales')
  .build();

// 3단계: 매핑 선언 — F : 급여팀(target) → 인사팀(source)
//   방향이 직관과 반대인 것에 주의: "내가 원하는 출력 모양"에서
//   "내가 이미 가진 데이터"로 향한다 (Δ_F(I) = I∘F 를 위해).
const F_payroll: SchemaMapping = {
  onObjects: { Worker: 'Employee', CostCenter: 'Department' },
  onMorphisms: { billedTo: ['worksIn'] },          // 관계도 명시적으로 매핑
  onAttributes: {                                   // 속성 이름이 다르면 여기서 대응
    Worker: { fullName: 'name', monthlyPay: 'salary' },
    CostCenter: { label: 'name' },
  },
};

// 4단계: 법칙 검사 (데이터는 아직 하나도 안 움직임)
console.log('법칙 검사:', checkSchemaMappingLaws(F_payroll, payrollSchema, hrSchema).isFunctor);

// 5단계: Δ_F 실행 — 변환 코드 한 줄 없이 급여팀 모양의 데이터가 나옴
const payrollData = deltaF(F_payroll, hrData, payrollSchema);
console.log('Worker rows:', payrollData.rows.Worker);
console.log('CostCenter rows:', payrollData.rows.CostCenter);
console.log('billedTo:', payrollData.fk.billedTo);

// 6단계: 결과 자체도 유효한가 (함자의 합성 — 자동으로 보장됨)
console.log('결과 유효성:', checkInstanceIsFunctor(payrollSchema, payrollData).isFunctor);

// (+) 값을 새로 계산해야 할 때는 Δ_F가 아니라 별도 계층
const withAnnual = withDerivedAttributes(payrollData, 'Worker', (row) => ({
  annualCost: (row.monthlyPay as number) * 12,
}));
console.log('연봉 계산 추가 (withDerivedAttributes):', withAnnual.rows.Worker);

// ── 매핑이 틀렸을 때 ──
console.log('\n--- 오타를 냈을 때: monthlyPay ← "salery" ---');
const F_typo: SchemaMapping = {
  ...F_payroll,
  onAttributes: {
    Worker: { fullName: 'name', monthlyPay: 'salery' },  // 오타
    CostCenter: { label: 'name' },
  },
};
for (const v of checkSchemaMappingLaws(F_typo, payrollSchema, hrSchema).violations) {
  console.log(`  [${v.reason}] ${v.subject}`);
  console.log(`    ${v.detail}`);
}

// ════════════════════════════════════════════════════════════════
// 예제 B — 자산정보 ↔ 위기가구발굴 (완전히 다른 도메인, 똑같은 형식)
// ════════════════════════════════════════════════════════════════
line('예제 B — 자산정보 → 위기가구발굴');

const assetSchema: DomainSchema = {
  objects: {
    가구: { attributes: [{ name: '가구주', type: 'string' }, { name: '자산총액', type: 'number' }] },
    계좌: { attributes: [{ name: '잔액', type: 'number' }] },
  },
  morphisms: [{ name: '소유', from: '가구', to: '계좌' }],
};
const crisisSchema: DomainSchema = {
  objects: {
    대상자: { attributes: [{ name: '성명', type: 'string' }, { name: '보유자산', type: 'number' }] },
    금융계좌: { attributes: [{ name: '잔액', type: 'number' }] },
  },
  morphisms: [{ name: '연계계좌', from: '대상자', to: '금융계좌' }],
};

const assetData = new InstanceBuilder()
  .addRow('계좌', { id: 'a1', 잔액: 1200 })
  .addRow('계좌', { id: 'a2', 잔액: 80 })
  .addRow('가구', { id: 'h1', 가구주: '김OO', 자산총액: 3200 })
  .addRow('가구', { id: 'h2', 가구주: '이OO', 자산총액: 450 })
  .setFk('소유', 'h1', 'a1')
  .setFk('소유', 'h2', 'a2')
  .build();

const F_crisis: SchemaMapping = {
  onObjects: { 대상자: '가구', 금융계좌: '계좌' },
  onMorphisms: { 연계계좌: ['소유'] },
  onAttributes: {
    대상자: { 성명: '가구주', 보유자산: '자산총액' },   // 이름이 다른 개념을 명시적으로 대응
    금융계좌: { 잔액: '잔액' },
  },
};

console.log('법칙 검사:', checkSchemaMappingLaws(F_crisis, crisisSchema, assetSchema).isFunctor);
const crisisData = deltaF(F_crisis, assetData, crisisSchema);
console.log('대상자 rows:', crisisData.rows.대상자);
console.log('금융계좌 rows:', crisisData.rows.금융계좌);
console.log('연계계좌:', crisisData.fk.연계계좌);
console.log('결과 유효성:', checkInstanceIsFunctor(crisisSchema, crisisData).isFunctor);

// ── 대응 관계를 아예 선언하지 않으면 (v0.3.0에서 새로 잡히는 것) ──
console.log('\n--- onAttributes를 선언하지 않았을 때 (암묵적 항등 매핑) ---');
const F_noAttrs: SchemaMapping = {
  onObjects: { 대상자: '가구', 금융계좌: '계좌' },
  onMorphisms: { 연계계좌: ['소유'] },
  // onAttributes 없음 → "이름이 같을 것"으로 간주하고, 그것도 검증함
};
const noAttrsReport = checkSchemaMappingLaws(F_noAttrs, crisisSchema, assetSchema);
console.log('법칙 검사:', noAttrsReport.isFunctor);
for (const v of noAttrsReport.violations) {
  console.log(`  [${v.reason}] ${v.subject}`);
  console.log(`    ${v.detail}`);
}

// ════════════════════════════════════════════════════════════════
line('두 예제의 대조');
console.log(`
                    예제 A (인사/급여)            예제 B (자산/위기가구)
─────────────────────────────────────────────────────────────────────
매핑의 "형식"        onObjects/onMorphisms/       onObjects/onMorphisms/
                    onAttributes                 onAttributes          ← 완전히 동일
매핑의 "내용"        Worker ← Employee 등          대상자 ← 가구 등        ← 완전히 다름
검증 함수            checkSchemaMappingLaws       checkSchemaMappingLaws ← 같은 함수
이관 함수            deltaF                       deltaF                 ← 같은 함수

즉: 매핑 내용은 그룹 쌍마다 새로 선언해야 한다(없앨 수 없는 정보).
    그러나 그것을 표현하는 형식과 검증하는 엔진은 도메인과 무관하게 하나다.`);
