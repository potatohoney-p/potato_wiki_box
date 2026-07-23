<p align="center">
  <img src="assets/brand/potato-box-mark.svg" width="112" height="112" alt="potato box 로고">
</p>

<h1 align="center">potato box</h1>

<p align="center">
  <strong>흩어진 자료를 서로 연결된, 직접 검토할 수 있는 지식으로 바꿉니다.</strong>
</p>

<p align="center">
  Markdown, 명시적 출처, 사람의 검토를 중심에 둔 로컬 우선 AI 워크스페이스
</p>

<p align="center">
  <a href="https://github.com/potatohoney-p/potato_wiki_box/actions/workflows/ci.yml"><img alt="CI 상태" src="https://github.com/potatohoney-p/potato_wiki_box/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <img alt="로컬 우선" src="https://img.shields.io/badge/data-local--first-326BFF?style=flat-square">
  <img alt="데스크톱 플랫폼" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-242833?style=flat-square">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-F39B2F?style=flat-square">
  <img alt="GPL-3.0-only 라이선스" src="https://img.shields.io/badge/license-GPL--3.0--only-13A06F?style=flat-square">
</p>

<p align="center">
  <a href="README.md">English</a> | 한국어 | <a href="README_CN.md">中文</a> | <a href="README_JA.md">日本語</a>
</p>

<p align="center">
  <img src="assets/readme/potato-box-cover.jpg" alt="문서와 지식 노드가 연결된 모듈형 potato box">
</p>

potato box는 문서와 웹 자료를 가져와 구조화된 Markdown 페이지로 바꾸고, 결과를 신뢰하는 데 필요한 링크, 출처, 검토 상태, 작업 이력을 함께 관리합니다. 프로젝트는 평범한 폴더이므로 Git, Obsidian, 스크립트, 기존 편집기에서 potato box 없이도 그대로 열 수 있습니다.

목표는 일회성 채팅이 아니라 시간이 지나도 남는 연구 자산입니다. 대화는 프로젝트 문맥을 사용하고, 장기 지식은 사람이 읽고 비교하고 수정하고 옮길 수 있는 파일에 저장됩니다.

## potato box가 다른 점

| 기본은 로컬 | 결과는 투명하게 | 지식은 계속 연결되게 |
| --- | --- | --- |
| 원본, 생성 페이지, 채팅, 큐, 인덱스가 프로젝트와 함께 저장됩니다. 외부 전송은 사용자가 설정한 기능과 공급자를 사용할 때만 발생합니다. | 지식은 YAML frontmatter, wikilink, 출처를 포함한 Markdown입니다. 생성된 변경은 영구 상태가 되기 전에 검토할 수 있습니다. | 검색, 그래프, 채팅, Deep Research, 린트, 상태 점검이 같은 프로젝트를 사용하므로 기능마다 정보가 고립되지 않습니다. |

## 실제 워크스페이스

<p align="center">
  <img src="assets/readme/workspace-graph.png" alt="개념과 출처가 연결된 potato box 지식 그래프">
</p>

<table>
  <tr>
    <td width="50%">
      <img src="assets/readme/linked-page.png" alt="출처, 태그, 관련 페이지가 표시된 생성 지식 페이지">
      <br><strong>검토 가능한 지식 페이지</strong><br>
      생성된 Markdown의 출처, 태그, 관련 페이지를 한 화면에서 확인합니다.
    </td>
    <td width="50%">
      <img src="assets/readme/semantic-search.png" alt="키워드 및 의미 검색 결과">
      <br><strong>워크스페이스 검색</strong><br>
      키워드, 그래프, 선택적 벡터 검색을 함께 사용합니다.
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="assets/readme/review-queue.png" alt="제안된 지식 변경을 확인하는 리뷰 큐">
      <br><strong>사람 중심 검토</strong><br>
      제안된 변경을 승인하거나 거절할 때까지 명시적으로 남겨 둡니다.
    </td>
    <td width="50%">
      <img src="assets/readme/knowledge-health.png" alt="배포 빌드의 Knowledge Health 결과">
      <br><strong>Knowledge Health</strong><br>
      구조, 링크, 출처, 중복, 복구 가능성을 한곳에서 점검합니다.
    </td>
  </tr>
</table>

모든 화면은 영문 전용 합성 Atlas Research 프로젝트를 사용해 네이티브 데스크톱 앱에서 Playwright로 직접 검증하고 캡처했습니다. 출처와 재사용 기준은 [자산 설명](assets/readme/README.md)에 기록되어 있습니다.

## 지식이 쌓이는 방식

<p align="center">
  <img src="assets/readme/knowledge-loop.svg" alt="원본이 영속 수집, 연결형 Markdown, 검색, 검토, 상태 점검으로 이어지는 흐름">
</p>

그래프는 채팅 문장 하나하나를 자동으로 말풍선처럼 그리는 화면이 아닙니다. 노드는 저장된 wiki 페이지이고, 간선은 영구적인 wikilink와 출처 관계입니다. 수집, 리서치, 편집, 승인된 변경이 아이디어를 페이지로 만들고 채팅은 그 지식을 바탕으로 사고하도록 돕습니다. 그래서 대화가 끝나도 그래프가 의미를 유지합니다.

## 핵심 기능

| 영역 | 포함 기능 |
| --- | --- |
| 자료 수집 | 파일, 폴더, 브라우저 클립, 소스 폴더 감시, 영속 큐, 중단 복구, 중복 방지, 증분 캐시, 실패 작업 가시화 |
| 문서 이해 | PDF/Office 텍스트 추출, 포함 이미지 추출, 선택적 비전 캡션, 타입별 페이지로 제한된 안전한 생성 |
| 지식 워크스페이스 | Markdown 편집, YAML frontmatter, wikilink, 출처, 자동 인덱스, 출처·개념·엔티티·질문·비교·종합 페이지 |
| 검색과 추론 | 키워드 검색, 그래프 기반 검색, 선택적 LanceDB 벡터, 명시적 문맥 예산, 프로젝트 기반 채팅, 설정 가능한 Deep Research |
| 그래프와 인사이트 | 대화형 지식 그래프, 필터, 이웃 탐색, 커뮤니티 탐지, 연결에서 원문 페이지로 이동 |
| 품질과 검토 | 리뷰 큐, 의미 린트, 링크·스키마 점검, 중복 탐지, Knowledge Health, 민감값을 가린 진단 내보내기 |
| 신뢰성 | 원자적 파일 교체, 프로젝트별 상태 분리, 취소를 고려한 수집, 버전 백업, SHA-256 인벤토리 검증, 새 폴더 복원 |
| 연동 | 토큰 인증 localhost API, 번들 MCP 서버, Chrome/Firefox 호환 클리퍼, Git 친화적 파일, Obsidian 호환 프로젝트 |

## AI 공급자 선택

언어 모델, 임베딩 모델, 문서 파서, 웹 검색 공급자는 서로 독립적으로 설정합니다.

- 호스팅 API 또는 OpenAI/Anthropic 호환 endpoint를 사용할 수 있습니다.
- Ollama, LM Studio, llama.cpp, vLLM, LocalAI 같은 로컬 endpoint를 사용할 수 있습니다.
- 이미 로그인된 Codex CLI 또는 Claude Code CLI를 별도 API 키 없이 재사용할 수 있습니다.
- OpenAI 호환, Gemini, Volcengine 호환 임베딩으로 의미 검색을 추가할 수 있습니다.
- 웹 리서치 공급자는 별도 설정입니다. 일반 수집, 편집, 검색, 그래프 사용에는 웹 검색 공급자가 필요하지 않습니다.

공급자 설정은 앱의 로컬 환경설정에 저장되어 다음 실행 때 복원됩니다. 프로젝트 Markdown에는 API 키를 기록하지 않습니다. 민감한 자료를 처리하기 전 [프라이버시 문서](docs/PRIVACY.md)를 확인하세요. 로컬 우선은 사용자가 설정한 외부 공급자 요청까지 기기 안에 남는다는 뜻은 아닙니다.

## 설치

버전 태그를 발행하면 다음 결과물이 GitHub Release에 생성됩니다.

| 플랫폼 | 배포 파일 |
| --- | --- |
| Windows x64 | NSIS `.exe`, MSI `.msi` |
| macOS Apple Silicon | `.dmg` |
| Linux x64 및 ARM64 | AppImage, `.deb` |
| Chromium/Firefox 호환 브라우저 | Release에 첨부되는 브라우저 클리퍼 ZIP |

[GitHub Releases](https://github.com/potatohoney-p/potato_wiki_box/releases)에서 운영체제에 맞는 파일을 받습니다. 다시 만들 수 없는 프로젝트를 업그레이드하기 전에는 릴리스 노트를 확인하고 백업 복원을 먼저 검증하세요.

### 소스에서 실행

필요 환경:

- Node.js 22 이상
- `rustfmt`, `clippy`를 포함한 Rust stable
- Protocol Buffers 컴파일러(`protoc`)
- 운영체제별 [Tauri 2 사전 요구 사항](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm ci --prefix mcp-server
npm run tauri dev
```

`npm run dev`로 브라우저 전용 화면을 열 수 있지만 파일시스템, 백업, 벡터, API, MCP, 클리퍼의 실제 동작은 Tauri가 필요합니다.

배포 번들 빌드:

```bash
npm run build
npm run tauri build
```

Windows 기여자는 표준 MSVC Build Tools 또는 [CONTRIBUTING.md](CONTRIBUTING.md)의 LLVM/xwin 구성을 사용할 수 있습니다.

## 첫 프로젝트 흐름

1. **Create Project**에서 부모 폴더를 선택하고 프로젝트 목적을 작성합니다.
2. **Settings -> AI Providers**에서 호스팅, 호환, 로컬, CLI 공급자 중 하나를 선택한 뒤 연결 테스트를 실행합니다.
3. **Sources**에서 자료를 추가하거나 `raw/sources/`에 파일을 넣습니다.
4. 영속 수집 큐가 페이지, 링크, 인덱스, 출처를 생성하도록 기다립니다.
5. 프로젝트 기반 질문을 하고, 답변의 페이지 참조와 그래프 이웃을 따라가 봅니다.
6. 리뷰와 린트 항목을 처리한 뒤 **Knowledge Health**를 확인합니다.
7. 대규모 수집, 마이그레이션, 공급자 변경 전 백업을 만듭니다.

Deep Research는 선택 기능입니다. “Deep Research sources are not configured” 알림이 나오면 **Settings -> External Information Sources**에서 웹 검색 또는 AnyTXT 공급자를 설정하세요. 설정하지 않아도 나머지 워크스페이스 기능은 계속 사용할 수 있습니다.

## 프로젝트 구조

```text
my-project/
|-- purpose.md
|-- schema.md
|-- raw/
|   |-- sources/
|   `-- assets/
|-- wiki/
|   |-- index.md
|   |-- log.md
|   |-- entities/
|   |-- concepts/
|   |-- sources/
|   |-- queries/
|   |-- comparisons/
|   |-- synthesis/
|   `-- media/
`-- .potato-box/
    |-- chats/
    |-- clip-queue/
    |-- clip-receipts/
    |-- lancedb/
    |-- migrations/
    |-- recovery/
    |-- trash/
    `-- 앱 상태 및 캐시
```

Markdown과 가져온 원본이 장기 보존의 기준입니다. LanceDB는 다시 만들 수 있는 인덱스이고, `.potato-box`에는 프로젝트별 작업 상태가 들어갑니다. 호환되는 이전 프로젝트를 열면 기존 데이터의 이동 또는 복사가 성공하기 전에 이전 앱 상태를 삭제하지 않고 마이그레이션합니다.

## 자동화와 연동

### 로컬 API와 MCP

데스크톱 앱은 로컬 자동화를 위해 `http://127.0.0.1:19828/api/v1`을 열 수 있습니다. health 이외의 모든 요청은 `X-Potato-Box-Token` 또는 Bearer 토큰이 필요합니다. 공개 프로젝트 ID는 UUID이고 `current`만 별칭으로 허용하며, 파일 경로는 API 프로젝트 ID로 받지 않습니다.

번들 MCP 서버는 같은 API로 요청을 전달하므로 프로젝트 목록, 검색 규칙, 파일 허용 목록을 공유합니다. 상태, 프로젝트, 파일, 리뷰, 검색, 그래프, 소스 재탐색 도구를 제공합니다. [MCP 서버 가이드](mcp-server/README.md)와 [API 레퍼런스](docs/API.md)를 참고하세요.

### 브라우저 클리퍼

`extension/`을 압축 해제 확장으로 불러오거나 태그 Release의 ZIP을 사용합니다. **Settings -> API + MCP**에서 API 토큰과 프로젝트 UUID를 설정합니다. 요청 크기 제한, 충돌 없는 파일명, 영속 대기 마커, 멱등성 receipt를 사용하므로 응답 시간 초과 뒤 재시도해도 같은 클립을 중복 생성하지 않습니다.

## 데이터, 프라이버시, 복구

- 프로젝트 내용과 프로젝트별 상태는 선택한 프로젝트 폴더에 저장됩니다.
- 앱 전체 환경설정은 운영체제의 Tauri 앱 데이터 디렉터리에 저장됩니다.
- 설정된 LLM, 임베딩, 검색, 비전, 파싱, 업데이트 서비스를 사용할 때 내용이 기기 밖으로 전송될 수 있습니다.
- 진단 파일은 알려진 비밀값을 가리고 원문 본문을 기본 제외하지만, 공유 전 사람이 다시 확인해야 합니다.
- 백업은 모든 파일의 크기와 SHA-256을 기록한 버전 manifest를 포함하며, 전체 목록을 검증한 뒤 새 디렉터리에 프로젝트를 복원합니다.
- 로컬 API와 클리퍼는 loopback에만 bind하지만 localhost도 인증 경계가 아니므로 토큰을 항상 요구합니다.

연동을 외부에 노출하거나 민감한 데이터를 다루기 전 [프라이버시](docs/PRIVACY.md), [위협 모델](docs/THREAT_MODEL.md), [보안 정책](SECURITY.md)을 확인하세요.

## 개발과 품질

potato box는 React 19/TypeScript 프론트엔드와 Rust 백엔드로 구성된 Tauri 2 데스크톱 앱입니다. 프론트엔드는 상호작용과 프로젝트별 화면을 담당하고, Rust는 파일시스템, 추출, 백업/복원, 벡터 저장소, 로컬 서비스의 권한을 가집니다. 자세한 내용은 [아키텍처 문서](docs/ARCHITECTURE.md)를 참고하세요.

```bash
npm run typecheck
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

`npm test`는 프론트엔드 mock 테스트, MCP 테스트, 문서 링크 검사를 실행합니다. 실제 외부 공급자를 쓰는 테스트는 인증 정보를 사용하고 비용이 발생할 수 있으므로 명시적으로 실행해야 합니다.

```bash
npm run test:real
```

## 기여

[CONTRIBUTING.md](CONTRIBUTING.md)에서 시작하세요. 프로젝트 형식, 보안 경계, 공급자 계약, 마이그레이션을 바꾸는 변경은 테스트와 호환성 설명을 포함해야 합니다. 취약점은 공개 재현 글 대신 [SECURITY.md](SECURITY.md)의 비공개 신고 절차를 사용하세요.

추가 문서:

- [변경 이력](CHANGELOG.md)
- [거버넌스](GOVERNANCE.md)
- [릴리스 절차](docs/RELEASING.md)
- [브랜드와 자산 가이드](docs/BRAND.md)

## 라이선스와 고지

potato box는 GNU General Public License v3.0으로 배포됩니다. 전체 조건은 [LICENSE](LICENSE), 필수 출처 표기와 제3자 고지는 [NOTICE](NOTICE)를 확인하세요.
