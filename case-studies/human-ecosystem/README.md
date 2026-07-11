# Human Ecosystem Control — 도시 사회 생태계 관제 (TemporalRunner v0.2.0 첫 실전)

15개 사회 도메인(경제·보건·환경·주거인프라·사회)이 서로 영향을 주고받는
도시 생태계를 실시간 관제하는 데모. 금융위기·팬데믹·기후재난 같은 위기와
재정부양 같은 정책 개입을 주입하면, 영향이 **카테고리 경계를 넘어**
전파되는 걸 눈으로 볼 수 있다.

```
브라우저: python3 -m http.server 8000 → http://localhost:8000/control-room.html
```

## 이 데모가 앞선 것들과 결정적으로 다른 점

**전파가 라이브러리 정식 기능으로 돌아간다.** supply-chain/road-network
데모는 전파를 시뮬레이터의 수작업 "이전 틱" 변수로 구현했다(논문
Limitation 4). 이 데모에서는 각 도메인 에이전트가
`options.temporal.previousInsight(상류)`를 직접 읽어 스스로 유효수준을
계산하며, 이 temporal 컨텍스트는 v0.2.0의 `TemporalRunner`가 관리하는
동결 스냅샷이다 — 수작업 전파 루프가 코드에 존재하지 않는다.

```
15개 도메인   ->  실제 createAgent() (전파 로직이 에이전트 내부에 있음)
틱 진행       ->  실제 TemporalRunner.step() (t-1 스냅샷 동결 규칙)
통합 판단     ->  실제 MetaAgent.run()
자연성 검사   ->  실제 NaturalTransformation.checkNaturality()
```

## 구조 — 순환과 교차

```
경제 루프:   고용 -> 가계소득 -> 소비 -> 소상공인 -> 고용  (피드백 순환)
교차 사슬:   기후 -> 대기질 -> 공중보건 -> 고용  (환경→보건→경제)
            고용 -> 치안 -> 신뢰 -> 소상공인  (경제→사회→경제)
```

순환 구조는 이전 데모(선형/격자)에는 없던 것이다. TemporalRunner의
스냅샷 규칙(틱 t는 t-1만 읽음) 덕분에 순환이 있어도 평가 순서 문제가
발생하지 않으며, 회복률과 전파율의 균형에 의해 순환이 영구 붕괴가 아니라
감쇠로 수렴한다.

## 사전 검증 (verify-mechanism.ts — 실제 라이브러리로 실행)

```
t0 금융위기(고용) -> t1 소득·정신건강·치안 -> t2 소비·신뢰 -> t3 소상공인
(첫 경보 도달 틱 == 그래프 거리, 홉당 1틱 — TemporalRunner 테스트 57번과 동일 성질)
t20: 전 도메인 회복 진행 — 경제 순환 루프가 영구 붕괴하지 않고 감쇠 확인
```

```bash
TS_NODE_COMPILER_OPTIONS='{"esModuleInterop":true,"module":"commonjs","skipLibCheck":true}' \
  npx ts-node case-studies/human-ecosystem/verify-mechanism.ts
```

## 정직한 경계

전파 규칙(임계 85, 전파율 1.0, 회복 0.04)은 실제 사회과학 모형이 아니라
전파 메커니즘을 보여주기 위한 단순화다. 이 데모가 증명하는 것은 "사회를
정확히 예측한다"가 아니라, "이질적 도메인들이 순환·교차 구조로 얽혀
있어도, 그 위의 정보 흐름이 순서 무관하고 시점 규칙이 명확한 방식으로
합성된다"는 프레임워크의 성질이다.
