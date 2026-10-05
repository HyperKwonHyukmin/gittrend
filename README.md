# GitTrend

GitHub에서 요즘 주목받는 라이브러리를 모아서, AI(OpenAI)가 **무엇인지 · 왜 뜨는지 · 주요 특징 · 사용법 · 비슷한 도구 · 주의점**을 한국어로 정리해 주는 대시보드입니다. 최근 **AI 뉴스**도 모아서 한국어로 요약합니다. PC와 모바일 모두에서 볼 수 있습니다.

## 탭과 데이터 출처

| 탭 | 출처 | 의미 |
|---|---|---|
| 종합 주목 | 아래 전부 | 여러 목록에 동시에 뜬 저장소일수록 위로. 맨 위에 AI가 쓴 "요즘 흐름" 요약 |
| ★ 관심 | 내가 저장한 것 | ☆로 저장한 라이브러리와, 그와 비슷한 라이브러리 추천 |
| 오늘 / 이번 주 / 이번 달 | GitHub Trending | 기간 동안 받은 star 수 |
| 새로 뜬 (7일 / 30일) | GitHub 검색 API | 최근에 만들어졌는데 star가 많은 저장소 |
| HN 화제 | Hacker News (Algolia API) | 개발자 커뮤니티에서 추천과 댓글을 많이 받은 저장소 |
| 급상승 | 자체 star 기록 | 어제보다 star가 많이 늘어난 저장소. 이틀째부터 나타남 |

그 밖에: 오늘 처음 등장한 저장소의 **NEW** 표시와 "NEW만 보기", 언어·분류 필터, 정렬, 저장소별 star 변화 그래프, 마지막 커밋·최신 릴리스·보관 여부 표시가 있습니다.

## AI 정리는 한 번만

저장소마다 AI 정리를 **딱 한 번** 만들어 `docs/data/repos/<저장소>.json`에 영구 보관합니다. 순위에서 빠졌다가 다시 올라와도 저장된 정리를 그대로 쓰므로, API는 처음 보는 저장소에만 쓰입니다. 하루 사용량은 대체로 "그날 새로 뜬 저장소 수 + 트렌드 요약 1회"입니다.

## 관심 목록과 추천

- 카드나 상세 화면의 ☆를 누르면 관심 목록에 저장됩니다.
- **★ 관심** 탭에서 저장한 라이브러리와 분류·태그·토픽·설명 키워드가 겹치거나, AI가 비슷한 도구로 꼽은 라이브러리를 추천합니다. 후보는 오늘 순위만이 아니라 지금까지 수집된 모든 저장소(`docs/data/catalog.json`)입니다.
- 각 저장소 상세 화면 아래에도 "비슷한 라이브러리"가 나옵니다.
- 관심 목록은 **각 기기의 브라우저에만** 저장됩니다. ★ 관심 탭 맨 아래 "다른 기기로 옮기기" 링크를 폰에서 열면 같은 목록을 가져옵니다.

## AI 뉴스

상단의 **AI 뉴스**를 누르면 최근 AI 기사와 트렌드를 볼 수 있습니다.

| 출처 | 방식 | 키 |
|---|---|---|
| Google 뉴스 (국내·해외) | RSS | 필요 없음 |
| AI타임스, TechCrunch AI, The Verge AI | RSS | 필요 없음 |
| GeekNews (AI 관련 글만) | RSS | 필요 없음 |
| Hacker News (AI 화제글), Hugging Face 오늘의 논문 | 공개 API | 필요 없음 |
| 네이버 뉴스 | 네이버 검색 API | `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` |
| Threads | Threads API 키워드 검색 | `THREADS_ACCESS_TOKEN` |

- **AI는 기사 하나당 한 번만** 씁니다. 새 기사를 40건씩 묶어 한 번에 보내서, AI 관련 여부·같은 사건 묶기·한국어 제목·1~2문장 요약·주제·중요도(1~5)를 받습니다. 처리한 기사는 `data/news_seen.json`에 기록해 다시 보내지 않습니다. "오늘의 AI 브리핑"은 하루 한 번 만듭니다.
- 기사 본문은 가져오지 않습니다. 제목과 RSS 요약문만으로 정리하고 원문으로 링크합니다.
- 화면에서는 주제별 보기, 국내/해외/커뮤니티·논문 출처 고르기, 최신순/중요도순, "주요 뉴스만", 같은 소식 묶음, 읽은 기사 흐리게 표시를 쓸 수 있습니다.
- 뉴스는 하루 두 번(오전 7시, 오후 6시) 모읍니다. 최근 14일치를 보여줍니다.

### 네이버 키 받기 (무료, 하루 2만5천 회)

1. https://developers.naver.com 에 로그인 → **Application → 애플리케이션 등록**
2. 사용 API에서 **검색**을 고르고, 환경은 **WEB 설정**에 아무 주소(예: `https://<아이디>.github.io`)나 넣습니다.
3. 발급된 **Client ID**와 **Client Secret**을 저장소 Secrets의 `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`에 넣습니다.

### Threads 토큰 받기 (선택, 번거로움)

1. https://developers.facebook.com 에서 앱을 만들고 **Threads API** 사용 사례를 추가합니다.
2. 권한 `threads_basic`, `threads_keyword_search`를 추가하고, 내 Threads 계정을 테스터로 등록한 뒤 액세스 토큰을 발급합니다.
3. 장기 토큰(60일)을 저장소 Secrets의 `THREADS_ACCESS_TOKEN`에 넣습니다. **60일마다 다시 넣어야** 합니다.
4. Meta의 앱 심사를 통과하기 전에는 키워드 검색 결과가 제한될 수 있습니다(본인 글 위주).

## 구조

```
collect.py                    라이브러리 수집 + AI 정리 (Python 표준 라이브러리만 사용)
news.py                       AI 뉴스 수집 + AI 정리 (collect.py가 마지막에 실행)
docs/                         대시보드 (GitHub Pages로 배포되는 폴더)
  index.html, app.js, style.css, 아이콘들
  data/index.json             오늘의 목록 + 트렌드 요약
  data/catalog.json           지금까지 본 모든 저장소 (추천, 예전 저장소 보기에 사용)
  data/spark.json             최근 30일 star 변화
  data/repos/*.json           저장소별 AI 정리 (한 번 만들면 그대로 보관)
  data/news.json              AI 뉴스 (최근 14일) + 오늘의 브리핑
data/history.json             날짜별 star 기록 (60일 보관)
data/meta.json                저장소 상세 정보 캐시
data/news_seen.json           AI로 처리한 기사 기록 (다시 보내지 않기 위함)
.github/workflows/update.yml  매일 오전 7시·오후 6시(한국시간) 자동 수집 → 배포
```

## PC에서 바로 써 보기

1. `.env.example`을 `.env`로 복사하고 `OPENAI_API_KEY`를 넣습니다.
   `GITHUB_TOKEN`은 선택 사항입니다. 넣으면 상세 정보(라이선스, 생성일, 최신 릴리스)와 급상승 추적이 풍부해집니다. github.com/settings/tokens 에서 권한 없이 발급하면 됩니다.
2. `run-local.bat`을 더블클릭합니다. 수집이 끝나면 http://localhost:5190 이 열립니다.
   수집 없이 화면만 다시 열 때는 `serve.bat`을 씁니다.

> PC에서 돌려서 만든 AI 정리도 파일로 남습니다. GitHub에 올리면 그대로 재사용되어 같은 저장소를 두 번 정리하지 않습니다.

## 밖에서도 보기 (GitHub Pages, 무료)

1. GitHub에 **Public** 저장소를 만들고 이 폴더를 올립니다. (`.env`는 `.gitignore`에 있어서 올라가지 않습니다.)
2. 저장소 **Settings → Secrets and variables → Actions**
   - Secrets 탭: `OPENAI_API_KEY` 추가
   - Secrets 탭 (선택): `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `THREADS_ACCESS_TOKEN`
   - Variables 탭 (선택): `OPENAI_MODEL` (기본 `gpt-5-mini`), `OPENAI_REASONING` (기본 `low`), `MAX_SUMMARIES` (기본 60), `MAX_NEWS_AI` (기본 160)
3. **Settings → Pages → Source**를 `GitHub Actions`로 바꿉니다.
4. **Actions 탭 → Update trends → Run workflow**로 처음 한 번 실행합니다.
   끝나면 `https://<아이디>.github.io/<저장소이름>/` 에서 볼 수 있습니다. 그 뒤로는 매일 오전 7시와 오후 6시에 자동으로 갱신됩니다.
5. 폰에서는 이 주소를 열고 "홈 화면에 추가"를 하면 앱처럼 쓸 수 있습니다.

- 무료 계정의 GitHub Pages는 공개 페이지입니다. 검색엔진에는 노출되지 않도록 `noindex`를 넣어 두었습니다.
- AI 키가 틀렸거나 크레딧이 떨어지면 정리를 즉시 멈추고, 모은 데이터는 그대로 배포한 뒤 실행을 **실패**로 표시합니다. GitHub가 실패 알림 메일을 보내 줍니다.
- 공개 저장소에서 오래 활동이 없으면 GitHub가 예약 실행을 멈출 수 있습니다. 멈추기 전에 메일이 오고, Actions 탭에서 다시 켤 수 있습니다.

## 비용

- GitHub Actions, Pages: 공개 저장소면 무료
- OpenAI: 저장소 하나 정리에 입력 약 5천 토큰. 첫 실행은 최대 60개, 그 뒤로는 새로 뜬 저장소만 정리합니다.
  AI 뉴스는 기사 40건을 한 번에 보내므로 기사당 비용이 작고, 하루 새 기사 200~300건 기준 호출 5~8번 정도입니다. platform.openai.com의 **Limits**에서 월 사용 한도를 걸어 두기를 권장합니다.
