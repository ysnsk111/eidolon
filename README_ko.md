# EIDOLON v1.4.0-preview.1

<p align="center">
  <strong>페르소나 증류, L4 동적 관계 상태 및 생체 메모리 런타임</strong><br>
  <em>«표현을 보존하고, 맥락을 재구성하며, 충실도를 측정하고, 진정한 존재감을 시뮬레이션한다.»</em>
</p>

<p align="center">
  <a href="README.md"><strong>🇨🇳 简体中文</strong></a> •
  <a href="README_en.md"><strong>🇺🇸 English</strong></a> •
  <a href="README_zh-TW.md"><strong>🇭🇰/🇹🇼 繁體中文</strong></a> •
  <a href="README_ja.md"><strong>🇯🇵 日本語</strong></a> •
  <a href="README_ko.md"><strong>🇰🇷 한국어</strong></a> •
  <a href="README_ru.md"><strong>🇷🇺 Русский</strong></a> •
  <a href="README_fr.md"><strong>🇫🇷 Français</strong></a> •
  <a href="README_es.md"><strong>🇪🇸 Español</strong></a> •
  <a href="docs/human-simulation-algorithm.md"><strong>📐 알고리즘 사양서 (Algorithm Spec)</strong></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Release-v1.4.0--preview.1-blue.svg" alt="Release: v1.4.0-preview.1">
  <img src="https://img.shields.io/badge/License-GPL%20v3.0-blue.svg" alt="License: GPL-3.0">
  <img src="https://img.shields.io/badge/Node.js-24%20LTS-green.svg" alt="Node.js: 24 LTS">
  <img src="https://img.shields.io/badge/Go-1.22+-00ADD8.svg" alt="Go 1.22+">
  <img src="https://img.shields.io/badge/SQLite-Native%20ACID-003B57.svg" alt="SQLite: Native ACID">
  <img src="https://img.shields.io/badge/L4%20State-BSM%20Engine-ff69b4.svg" alt="L4 State: BSM Engine">
  <img src="https://img.shields.io/badge/Tests-246%20Passed-brightgreen.svg" alt="Tests: 246 Passed">
</p>

---

## 목차

- [1. 프로젝트 재정의](#1-프로젝트-재정의)
- [2. 핵심 아키텍처 및 7개 증류 계층](#2-핵심-아키텍처-및-7개-증류-계층)
- [3. DSI 증류 유사도 지수](#3-dsi-증류-유사도-지수)
- [4. L4 동적 관계 상태 및 인간 시뮬레이션](#4-l4-동적-관계-상태-및-인간-시뮬레이션)
- [5. 빠른 시작 및 온보딩 마법사](#5-빠른-시작-및-온보딩-마법사)
- [6. CLI 명령어 레퍼런스](#6-cli-명령어-레퍼런스)
- [7. 라이선스](#7-라이선스)

---

## 1. 프로젝트 재정의

EIDOLON은 더 이상 단순히 "채팅 로그를 요약하여 시스템 프롬프트로 만드는" 툴이 아닙니다.

**V1.2 공식 정의:**
> **«실제 대화 기록에서 계산 가능한 언어 스타일, 행동 전략, 대화 리듬, 배경 맥락 및 기억 그래프를 증류하고, L4 동적 관계 및 감정 엔진으로 구동되며, 오프라인 독립 이중 블라인드 평가를 거쳐 스타일 일관성과 사실적 진실성을 엄격히 검증하여 실제 인간 동반자 수준의 존재감을 제공합니다.»**

EIDOLON은 엄격히 분리된 두 개의 폐쇄 루프로 작동합니다:
- **증류 루프 (Distillation Loop)**: 대화 데이터 수집 $\rightarrow$ 7개 계층 증류 $\rightarrow$ 페르소나 패키지 (.eidolon) 생성.
- **평가 루프 (Evaluation Loop)**: 블라인드 테스트 데이터 $\rightarrow$ 후보군 생성 (A/B/C) $\rightarrow$ 독립 LLM 판정 $\rightarrow$ DSI 지수 산출 및 개선.

---

## 2. 핵심 아키텍처 및 7개 증류 계층

| 계층 | 모듈명 | 분석 대상 및 특징 | 산출물 |
| :--- | :--- | :--- | :--- |
| **Layer 1** | 통계적 언어 지문 | 어휘 빈도, 문장부호 생략율, 말줄임표/물결표 지문, 메시지 길이 분포 | `language_model.json` |
| **Layer 2** | 조건부 스타일 모델 | 베이지안 조건부 확률 $P(\text{스타일} \mid \text{맥락})$, 감정 트리거 강도 | `style.json` |
| **Layer 3** | 계층적 행동 정책 트리 | 유머, 공감 지지, 분석, 반문 등 상황별 대응 전략 및 화제 전환율 | `behavior.json` |
| **Layer 4** | 동적 대화 리듬 | 메시지 길이별 응답 지연 시간, 연타 전송 확률 $P(\text{연타})$ | `rhythm.json` |
| **Layer 5** | 자산 및 이모티콘 바인딩 | 스티커, 이모티콘과 상황 간 의미론적 결합 매트릭스 | `assets.json` |
| **Layer 6** | 세계관 모델 & 맥락 보완 | 인물 관계 그래프, 사건 타임라인, 대화 사실과 사용자 설정 엄격 분리 | `world.json` |
| **Layer 7** | 생체 메모리 시드 | L0 단기 버퍼, L1 일화 기억(망각 곡선), L2 의미 사실, L3 세계관 | `memory_seed.json` |

---

## 5. 빠른 시작 및 온보딩 마법사

```bash
git clone https://github.com/ysnsk111/eidolon.git
cd eidolon
npm install
npm run build:server
npm start
```

온보딩 마법사 진행 순서:
1. **단계 0**: 언어 선택 (영어 기본, 한국어, 일본어, 중국어, 러시아어, 프랑스어, 스페인어 지원).
2. **단계 1**: 모델 API 연결 및 simple-test 검증.
3. **단계 2**: 증류할 대화 파일 경로 지정 및 배경 세계관 추가 입력.
4. **단계 3**: Telegram 봇 토큰 및 사용자 ID 등록.
5. **단계 4**: 백그라운드 서비스 시작 및 `/start` 명령을 통한 보안 페어링.
6. **단계 5**: 페르소나 증류 실행 확인 (Telegram 실시간 진행 보고 및 완료 후 올클리어).

---

## 6. CLI 명령어 레퍼런스

| 명령어 | 설명 |
| :--- | :--- |
| `eidolon init` | 대화형 온보딩 마법사 실행 및 SQLite 데이터베이스 초기화 |
| `eidolon config [show\|set\|test]` | 설정 확인, 수정 또는 모델 API simple-test 실행 |
| `eidolon distill <file> [options]` | 대화 데이터 증류, 7개 계층 모델 생성 및 오프라인 평가 실행 |
| `eidolon evaluate <persona>` | 지정된 페르소나에 대한 블라인드 평가 및 DSI 산출 |
| `eidolon validate <path>` | `.eidolon` 패키지 또는 디렉터리의 JSON 스키마 유효성 검사 |
| `eidolon persona [list\|activate\|install\|verify]` | 페르소나 목록 조회, 활성화, 안전 설치 및 검증 |
| `eidolon memory [status\|compact\|export]` | 메모리 현황 확인, 만료 데이터 정리 또는 전체 내보내기 |
| `eidolon bot [token\|user\|status]` | Telegram 봇 토큰 및 허용 사용자 관리 |
| `eidolon service [start\|stop\|restart\|status]` | 백그라운드 데몬 서비스 제어 |
| `eidolon logs [-n lines]` | 데몬 실시간 런타임 로그 확인 |
| `eidolon status` | 전체 시스템 및 하위 서브시스템 상태 점검 |
| `eidolon clear [--mode all\|chat-memory]` | 3단계 대화형 정리: 전체 초기화 (all-clear) 또는 대화/메모리만 정리 (페르소나 보존) |

---

## 7. 라이선스

본 프로젝트는 **GNU General Public License v3.0 (GPL-3.0)** 에 따라 라이선스가 부여됩니다.
