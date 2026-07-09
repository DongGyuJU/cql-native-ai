# Why It Matters: 같은 문제, 두 가지 구현

[bungae-mart](../bungae-mart)와 [gangnam-road](../gangnam-road)는
`cql-native-ai`가 **작동하는 모습**을 보여준다. 이 폴더는 반대를 보여준다
— **이 구조 없이 흔히 짜는 방식이 실제로 어떻게 깨지는지.**

같은 문제를 두 번 구현했다: 한 번은 실무에서 정말 흔한 ad-hoc 패턴으로
(허수아비가 아니라, 실제로 사람들이 짜는 코드), 한 번은 `cql-native-ai`로.
아래 출력은 전부 **실제 실행 결과**다.

```bash
npx ts-node --compiler-options '{"esModuleInterop":true,"module":"commonjs","skipLibCheck":true}' why-it-matters.ts
```

---

## Bug #1 — 도착 순서 의존성 (naturality violation)

**현실의 패턴**: 두 매장의 수요 급증 신호가 공유 창고 계획 서비스에
도착한다. 어느 매장 신호가 먼저 도착하는지는 네트워크 타이밍의 우연이지
비즈니스적 사실이 아니다. 그런데 "최신 신호를 가장 신뢰"하는 롤링 컨텍스트
패턴(last-write-wins — 공유 상태 그래프에서 매우 흔함)으로 합치면:

```
=== Version A (ad-hoc, shared mutable state) ===
Order 1 (성수점 → 강남점): 긴급 발주: 컵라면 53개 (신호: 강남점)
Order 2 (강남점 → 성수점): 긴급 발주: 생수 2L 66개 (신호: 성수점)
⚠️  MISMATCH: 어느 매장 신호가 늦게 도착했느냐에 따라 발주 품목 자체가 바뀜 (similarity: 0.30)
```

**같은 두 이벤트인데, 도착 순서에 따라 발주 품목 자체가 바뀐다.** 각 실행을
따로 보면 둘 다 그럴듯해서 — 두 실행을 비교하기 전까지는 버그인 줄도 모른다.
이것이 이 부류 버그가 프로덕션에서 오래 살아남는 이유다.

```
=== Version B (cql-native-ai) ===
Order 1: Attention needed: store-seongsu (...), store-gangnam (...). Recommended action: 생수 2L 66개 발주
Order 2: Attention needed: store-seongsu (...), store-gangnam (...). Recommended action: 생수 2L 66개 발주
✅ MATCH: 도착 순서와 무관하게 동일한 결론 (similarity: 1.00)
```

CQL 버전이 순서 무관한 이유는 규율이 아니라 **구조**다: 각 에이전트는 자기
입력만의 순수 함수이고, `MetaAgent`는 레지스트리에 등록된 순서로 —
입력이 도착한 순서가 아니라 — 대칭적으로 통합한다. 통합 결과가 "마지막에
도착한 것"을 특별 취급할 방법 자체가 없다.

> **정직한 한계 명시**: 이 시뮬레이션에서 "도착 순서"는 `inputs` 객체의
> 키 순서로 모델링했다. 실제 스트리밍 환경의 도착 순서와 완전히 같지는
> 않다. 또한 Version B의 순서 불변성은 `MetaAgent`의 현재 구현(레지스트리
> 순서 기반 처리)의 성질이며, 라이브러리의 `checkNaturality()`는 이런
> 불변성을 LLM 기반 에이전트에서도 **측정**할 수 있게 해주는 도구다 —
> LLM 에이전트는 순서 불변성이 자동으로 보장되지 않기 때문이다(라이브러리
> 유닛 테스트에 위반을 감지하는 케이스가 포함되어 있다).

## Bug #2 — 조용한 도메인 누락 (colimit completeness)

**현실의 패턴**: 나중에 `security` 도메인이 추가됐다. 알림 생성 코드는
정확하다 — 실제 위협을 감지했다. 그런데 요약 함수는 도메인이 2개이던
시절에 작성됐고, 아무도 업데이트하지 않았다. "알림은 있었는데 아무도 못
봤다" — 매우 흔한 실제 장애 카테고리다.

```
security 에이전트가 계산한 것:
  { status: 'warning', headline: 'POS 단말 3대에서 비정상 로그인 시도 감지' }

=== Version A (ad-hoc summarize()) ===
summarize() 출력: "수요 정상 / 재고 정상"
⚠️  보안 경고가 출력 어디에도 없음 — 에이전트는 정확히 감지했지만 아무도 못 봄
```

`summarize()`가 `if (insights.demand) ... if (insights.inventory) ...`처럼
도메인을 이름으로 하드코딩했기 때문이다. `security`는 인자로 전달까지
됐지만, 요약 코드가 그 존재를 모른다. 컴파일 에러도, 런타임 에러도 없다.
**그냥 조용히 사라진다.**

```
=== Version B (cql-native-ai) ===
unified.warningDomains: [ security ]
unified.insight: "Attention needed: security (POS 단말 3대에서 비정상 로그인
  시도 감지). Recommended action: 해당 단말 즉시 격리 및 비밀번호 재설정
  On track: demand, inventory."
✅ 보안 경고가 구조적으로 포함됨 — 요약 코드는 도메인 추가 시 0줄 수정
```

`MetaAgent`는 레지스트리를 순회하지 하드코딩된 이름을 보지 않는다.
도메인을 `register()`하는 순간 요약에 포함되는 것이 **구조적으로 보장**되고
(`unified.contributing`에는 전체 `DomainInsight`가 무손실 보존된다 —
lax colimit의 보편 성질), 빠뜨리는 실수 자체가 불가능해진다.

---

## 요약: 뭐가 다른가

| | ad-hoc | cql-native-ai |
|---|---|---|
| 도착 순서가 결론을 바꾸는가 | 그렇다 (그리고 아무 경고 없음) | 아니다 — 구조적으로 불가능 |
| 순서 의존성을 **측정**할 수 있는가 | 도구 없음 | `checkNaturality()` — 숫자로 나옴 |
| 새 도메인이 요약에서 누락될 수 있는가 | 그렇다 (조용히) | 아니다 — `register()`가 곧 포함 |
| 버그 발견 시점 | 프로덕션에서, 우연히 | 설계 단계에서, 구조적으로 |

두 버그 모두의 공통점: **각 구성 요소는 전부 정확했다.** 깨진 건 구성
요소들을 **합치는 방법**이었다. Category Theory가 CQL Native AI에 기여하는
지점이 정확히 여기다 — 합성(composition)의 정확성을 개별 요소의 정확성과
독립적으로 보장하는 것.
