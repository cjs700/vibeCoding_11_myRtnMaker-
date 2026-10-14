# WorkOut Timer Pro — Implementation Plan

## 프로젝트 개요

운동 타이머 웹 앱. 스마트폰/태블릿을 바닥에 두고 운동하면서 사용 가능한  
**모바일 우선 반응형** 인터페이스. 외부 라이브러리 없이 순수 HTML + CSS + JS로 구현.

---

## 파일 구조

```
Project11/
├── index.html               # 메인 HTML (시맨틱 마크업, WAI-ARIA)
├── style.css                # 다크모드 디자인 시스템 + 반응형 레이아웃
├── app.js                   # 타이머 로직 + 오디오 엔진 + LocalStorage
└── implementation_plan.md  # 이 문서
```

---

## 기능 구현 현황

### ✅ Prompt 1 — 스테이지 타입 · 오디오 · 색상 시각화

#### [스테이지 타입 선택]
모달 팝업에서 3가지 타입 선택 가능:

| 타입 | 동작 | 설정 항목 |
|------|------|-----------|
| **시간 제한 (Count Down)** | 운동 시간 카운트다운 | 운동 시간, 휴식 시간, 대기 시간 |
| **타바타 (Work/Rest 세트)** | 운동↔휴식을 세트 반복 | 운동 시간, 휴식 시간, 세트 수, 대기 시간 |
| **랩 타임 (Count Up)** | 랩 수만큼 카운트업 측정 | 랩 수, 대기 시간 |

#### [오디오 가이드] — Web Audio API (파일 없이 코드로 생성)
- **예비음 (삐·삐·삐)**: 페이즈 종료 4초 전 tick에서 1회 재생 → 화면에 3초 표시 시점에 들림
- **종료음 (삐이-)**: 페이즈 전환 순간 삼각파 0.5초 재생

```
오디오 재생 흐름 (예: workTime=30):
  t=4s 남음 표시 순간: playWarning() → 삐·삐·삐 (0.25s 간격 3연속)
  t=0s:               playFinish()  → 삐이-    (0.5s)
  → 다음 페이즈 시작
```

> **수정 이력**: 초기 구현에서 `timeLeft <= 3` 조건으로 매초 3회 울리는 버그 →  
> `timeLeft === 4` (decrement 직전)으로 수정하여 정확히 1회만 재생

#### [색상 시각화]
동적으로 CSS 클래스 부여:

| 상태 | 클래스 | 색상 |
|------|--------|------|
| 운동 중 | `.state-work` | 네온 그린 `#39FF84` |
| 휴식 중 | `.state-rest` | 네온 레드 `#FF4757` |
| 대기 중 | `.state-wait` | 회색 `#8892a4` |
| 정지 | `.state-idle` | 어두운 회색 |

---

### ✅ Prompt 2 — 디자인 · LocalStorage · 반응형

#### [디자인 스타일]
- 다크모드 기본 (`--bg-base: #0d0f14`)
- 포인트: 네온 그린 `#39FF84` + 일렉트릭 블루 `#00CFFF`
- 타이머 폰트: `Orbitron` (Google Fonts) — 굵고 거대한 숫자
- 글로우 효과: `box-shadow` + `text-shadow`

#### [루틴 저장 기능] — LocalStorage
```
저장 키: "workout_timer_routines"
저장 구조: [{ id, name, stages: [...], savedAt }]
```
- 💾 저장: 현재 스테이지 구성을 이름 지정 후 저장
- 📂 불러오기: 저장된 루틴 목록 → 선택 시 현재 구성 교체
- 삭제: 루틴별 삭제 버튼

#### [반응형 레이아웃]
| 화면 너비 | 레이아웃 |
|----------|---------|
| ≥ 769px | 2컬럼 (스테이지 목록 | 타이머) |
| ≤ 768px | 1컬럼, 타이머 상단 |
| ≤ 380px | 소형폰 최적화 |

---

### ✅ Prompt 3 — 휴식 시간 · 다음 버튼 · 대기 시간

#### [휴식 시간(초) 입력]
- countdown 모달: `휴식 시간(초)` 입력 필드 추가
- `restTime = 0`이면 휴식 없이 다음 스테이지 진행

#### [다음 버튼 `⏭`]
- 일반 스테이지: 즉시 다음 스테이지로 이동
- 랩 타임 진행 중: 다음 랩 기록 시작 (마지막 랩이면 다음 스테이지)

#### [대기 시간 (Wait Time)]
- 전 스테이지 타입에 `대기 시간(초)` 입력 필드
- 시작 시 회색 카운트다운 → 운동 전환
- `waitTime = 0`이면 대기 없이 즉시 시작

---

### ✅ Prompt 4 — 버그 수정

| 항목 | 원인 | 수정 방법 |
|------|------|----------|
| 추천 시나리오 1번 미동작 | 이벤트 미연결 | `data-scenario` 속성 + `forEach` 이벤트 등록 |
| `+추가` 모달 미표시 | `hidden` 속성 처리 누락 | `removeAttribute('hidden')` 호출 |
| `+추가` 반응 없음 | click 리스너 미등록 | `DOM.btnAddStage.addEventListener(...)` 추가 |

---

## 타이머 상태 흐름

```
[▶ 시작]
    └─ currentStageIdx = 0
    └─ initStage(0)
         ├─ waitTime > 0 → phase='wait', 카운트다운
         └─ waitTime = 0 → startWorkPhase() 즉시

[tick() 매 1초]
    wait  : timeLeft-- → 0이면 startWorkPhase()
    work  : timeLeft-- → 0이면 onWorkPhaseEnd()
    rest  : timeLeft-- → 0이면 onRestPhaseEnd()
    laptime: timeLeft++ (카운트업, 자동 진행 없음)

[경고음 타이밍]
    timeLeft === 4 → playWarning() (3초 남음에 들림)
    timeLeft === 0 → playFinish()  (전환)
```

---

## 추천 시나리오 데이터

### 시나리오 1 — 인터벌 트레이닝
```
준비          : countdown | work=5s  | rest=0s  | wait=0s
고강도운동 ×4 : countdown | work=30s | rest=15s | wait=3s
마무리 스트레칭: countdown | work=60s | rest=0s  | wait=3s
```

### 시나리오 2 — 타바타
```
타바타 세트: tabata | work=20s | rest=10s | sets=8 | wait=3s
```

### 시나리오 3 — 랩 타임
```
랩 기록 측정: laptime | laps=4 | wait=3s
```

---

*최종 업데이트: 2026-10-14*
