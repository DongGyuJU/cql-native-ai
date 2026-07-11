# Supply Chain Control Room — 라이브 시각화 (실제 라이브러리 실행)

`cql-native-ai`를 **실제로 실행하는** 인터랙티브 데모. 14개 노드
(공급자→항구→물류→창고→소매 + 수요/재무)로 구성된 무역 공급망에
무작위 충격을 주입하면, 영향이 그래프를 따라 전파되고 우측 패널에
실시간 통합 판단이 표시된다.

```
브라우저에서 control-room.html 열면 바로 실행됨 — 빌드/서버 불필요
```

## 이것은 재구현이 아니라 실제 라이브러리 실행이다

이전 버전과 달리, 이 데모는 라이브러리를 재구현하지 않는다. 실제
`src/` 코드가 esbuild로 브라우저 번들(`cql-native-ai.bundle.js`)로
컴파일되어, 데모가 다음을 **직접 호출**한다:

```
각 노드      ->  실제 createAgent()로 생성된 DomainAgent
등록         ->  실제 DomainRegistry.register()
통합 판단     ->  실제 MetaAgent.run()  (라이브러리의 colimit 로직)
                우측 패널의 판단 문장은 라이브러리가 생성한
                UnifiedInsight.insight 그대로이며, "via MetaAgent.run()
                . contributing=N . warningDomains=M"으로 실제 호출을 표시
자연성 검사   ->  실제 NaturalTransformation.checkNaturality()
                충격받은 상류 노드와 하류 노드로 진짜 자연변환을 구성해,
                두 상류 인사이트의 도착 순서를 바꿔 하류 결론이 달라지는지
                라이브러리가 직접 측정 (규칙 기반이라 1.00)
```

즉 이 데모는 **"이론 -> 라이브러리 -> 실제 실행"의 마지막 조각**이다:
논문에서 증명한 성질이, 배포된 npm 패키지의 실제 코드로, 브라우저에서
눈에 보이게 실행된다.

### 번들 재생성 방법

`src/`를 수정한 경우 번들을 다시 만들어야 한다:

```bash
npx esbuild browser-entry.ts --bundle --format=esm --platform=browser \
  --target=es2020 --outfile=case-studies/supply-chain/cql-native-ai.bundle.js
```

`browser-entry.ts`는 규칙 기반 API(createAgent/Registry/MetaAgent/
NaturalTransformation)만 노출한다. LLM provider는 fetch/API 키가 필요하고
결정론적 시각화와 무관하므로 번들에서 제외된다.

## 전파 메커니즘에 대한 정직한 한계

노드 간 전파(상류 손상이 하류로 번지는 것)는 강남대로 대시보드와
동일한 "이전 틱 참조" 패턴을 쓴다 — 라이브러리의 정식 History 기능이
아니라 시뮬레이터 내부의 수작업 구현이며, 이는 논문 Limitations (4)에
이미 명시된 것과 같은 한계다. 다만 각 노드의 상태 판정, 전체 통합,
자연성 검사는 위에 적은 대로 실제 라이브러리 호출이다.

## 검증 과정에서 실제로 잡은 것

Node.js로 로직을 미리 검증하며 두 가지 실제 문제를 발견해 고쳤다:

1. **전파가 너무 약함** — 초기 파라미터로는 충격이 1홉 만에 소멸했다.
   회복률/전파강도/임계값을 튜닝해 공급자->소매 4홉 전체가 t2/t4/t6/t8로
   시차 전파되도록 수정.
2. **자연성 검사 설계 오류** — 최초 버전은 서로 다른 두 연산을 비교하고
   있었다. 라이브러리의 실제 checkNaturality()를 호출하도록 교체한 뒤
   50회 무작위 시나리오 전부 1.00을 확인했다.

브라우저의 `<script type="module">` 실행을 jsdom이 지원하지 않아,
모듈 본문을 실제 ESM으로 import해 브라우저 전역(document 등)을 주입한
상태로 통합 검증했다: MetaAgent.run()과 checkNaturality()가 실제로
호출되어 각각 통합 판단과 자연성 점수 1.00을 반환함을 확인했다.
