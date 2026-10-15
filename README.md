# ScoreFlow Core

ScoreFlow의 UI와 분리된 브라우저용 핵심 로직입니다. 현재 구현 범위는 MusicXML 기반 단선율 악보 추적입니다.

## 포함된 기능

- `score-partwise` MusicXML의 마디, 음표, 화음, 페이지 나눔 파싱
- YIN 기반 실시간 단일 음높이 검출
- 마이크 및 Web MIDI 입력 어댑터
- 틀린 음, 건너뛴 음, 속도 변화를 허용하는 온라인 위치 추적
- 신뢰도와 지속 시간을 확인한 뒤 자동 페이지 전환
- 수동 마디 이동 및 IndexedDB 악보 저장
- 핵심 로직 단위 테스트

## 실행

```powershell
npm install
npm test
npm run build
```

UI에서는 `ScoreFlowEngine`에 `NoteObservation`을 전달하고 `update` 이벤트를 구독하면 됩니다. MusicXML 렌더링 좌표는 추후 OpenSheetMusicDisplay가 제공하는 마디 그래픽 정보와 `measureIndex`로 연결합니다.

## 현재 경계

- PDF는 구조화된 음표가 없어 자동 추적하지 않습니다. 뷰어 UI 단계에서 PDF.js를 연결할 수 있습니다.
- MusicXML 반복기호, D.C./D.S./Coda의 실제 연주 순서 전개는 아직 지원하지 않습니다.
- 마이크 경로는 단선율만 대상으로 하며 실제 악기·기기별 임계값 보정이 필요합니다.
- `MicrophonePitchSource`는 우선 동작 가능한 메인 스레드 분석입니다. 저사양 모바일 성능이 부족하면 같은 인터페이스를 유지한 채 AudioWorklet으로 옮깁니다.
