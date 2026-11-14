import contextlib
import datetime as dt
import io
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import collect
import deep
import news


class FakeStream:
    def __init__(self, message):
        self.message = message

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get_final_message(self):
        return self.message


def claude_reply(text, stop_reason="end_turn"):
    usage = SimpleNamespace(input_tokens=10, output_tokens=5, cache_creation_input_tokens=None,
                            cache_read_input_tokens=3)
    content = [SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=text)]
    return SimpleNamespace(stop_reason=stop_reason, usage=usage, content=content)


class ChatJsonTests(unittest.TestCase):
    def call(self, stream=None, error=None):
        client = MagicMock()
        client.beta.messages.stream.side_effect = error
        client.beta.messages.stream.return_value = stream
        with patch.object(collect.anthropic, "Anthropic", return_value=client),              patch.object(collect, "ai_month_used", return_value=0),              patch.object(collect, "_add_usage") as add,              patch.dict(os.environ, {"ANTHROPIC_API_KEY": "mock"}):
            result = collect.chat_json("sys", "user", collect.DIGEST_SCHEMA)
        return result, client.beta.messages.stream.call_args.kwargs, add

    def test_sends_schema_and_fallback_and_reads_text_block(self):
        result, sent, add = self.call(FakeStream(claude_reply('{"headline": "h"}')))
        self.assertEqual(result, {"headline": "h"})
        self.assertEqual(sent["model"], collect.DEFAULT_MODEL)
        self.assertEqual(sent["fallbacks"], "default")
        self.assertEqual(sent["output_config"]["format"]["schema"], collect.DIGEST_SCHEMA)
        add.assert_called_once_with(18, "")

    def test_refusal_and_cutoff_are_errors_not_data(self):
        for reason in ("refusal", "max_tokens"):
            with self.assertRaises(RuntimeError):
                self.call(FakeStream(claude_reply('{"headline":', reason)))

    def test_bad_key_and_empty_credit_stop_the_run(self):
        response = MagicMock(status_code=401, headers={})
        with self.assertRaises(collect.AIFatal):
            self.call(error=collect.anthropic.AuthenticationError("bad", response=response, body=None))
        response = MagicMock(status_code=400, headers={})
        with self.assertRaises(collect.AIFatal):
            self.call(error=collect.anthropic.BadRequestError("Your credit balance is too low", response=response, body=None))

    def test_all_schemas_are_strict(self):
        def walk(s):
            if s.get("type") == "object":
                self.assertIs(s["additionalProperties"], False)
                self.assertEqual(sorted(s["required"]), sorted(s["properties"]))
                for v in s["properties"].values():
                    walk(v)
            elif s.get("type") == "array":
                walk(s["items"])
        for s in (collect.SUMMARY_SCHEMA, collect.DIGEST_SCHEMA, news.NEWS_SCHEMA, news.CARD_SCHEMA,
                  news.BRIEF_SCHEMA, deep.DEEP_SCHEMA):
            walk(s)


class NewsTests(unittest.TestCase):
    def test_missing_results_remain_pending_and_can_be_retried(self):
        article = news.make("AI launch", "https://example.test", "test",
                            dt.datetime.now(collect.KST))
        files = {}
        result = {1: {"keep": True, "dup": 0, "title_ko": "AI launch",
                      "summary": "test", "kind": "업계 흐름", "importance": 2}}
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, {"ANTHROPIC_API_KEY": "mock"}))
            stack.enter_context(patch.object(news, "SOURCES", [("test", lambda: [article])]))
            stack.enter_context(patch.object(collect, "read_json",
                                            side_effect=lambda p, d: files.get(p, d)))
            for name in ("write_json", "write_json_lines"):
                stack.enter_context(patch.object(collect, name,
                                                side_effect=lambda p, d: files.update({p: d})))
            judge = stack.enter_context(patch.object(news, "ai_judge", side_effect=[{}, result]))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            news.run()
            self.assertEqual(len(files[news.NEWS_PATH]["articles"]), 1)
            self.assertNotIn(article["id"], files[news.SEEN_PATH])
            news.run()
            self.assertEqual(judge.call_count, 2)
            self.assertTrue(files[news.NEWS_PATH]["articles"][0]["ai"])
            self.assertIn(article["id"], files[news.SEEN_PATH])

    def test_explicit_rejection_is_recorded(self):
        article = news.make("Unrelated launch", "https://example.test", "test",
                            dt.datetime.now(collect.KST))
        files = {}
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "mock"}), \
                patch.object(news, "SOURCES", [("test", lambda: [article])]), \
                patch.object(collect, "read_json", side_effect=lambda p, d: d), \
                patch.object(news, "ai_judge", return_value={1: {"keep": False}}), \
                patch.object(collect, "write_json", side_effect=lambda p, d: files.update({p: d})), \
                patch.object(collect, "write_json_lines", side_effect=lambda p, d: files.update({p: d})), \
                contextlib.redirect_stdout(io.StringIO()):
            news.run()
        self.assertEqual(files[news.NEWS_PATH]["articles"], [])
        self.assertIn(article["id"], files[news.SEEN_PATH])

    def run_news(self, files, articles, judge_result=None, card=None):
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, {"ANTHROPIC_API_KEY": "mock"}))
            stack.enter_context(patch.object(news, "SOURCES", [("test", lambda: articles)]))
            stack.enter_context(patch.object(collect, "read_json", side_effect=lambda p, d: files.get(p, d)))
            for name in ("write_json", "write_json_lines"):
                stack.enter_context(patch.object(collect, name, side_effect=lambda p, d: files.update({p: d})))
            stack.enter_context(patch.object(news, "ai_judge", return_value=judge_result or {}))
            stack.enter_context(patch.object(news, "ai_brief", side_effect=ValueError("skip")))
            stack.enter_context(patch.object(news, "fetch_body", return_value="본문"))
            stack.enter_context(patch.object(deep, "read_profile", return_value=""))
            ai_card = stack.enter_context(patch.object(news, "ai_card", side_effect=card or [{"what": "카드"}]))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            news.run()
        return ai_card

    def test_important_items_get_a_card_once(self):
        article = news.make("New model", "https://example.test/m", "test", dt.datetime.now(collect.KST))
        files = {}
        judged = {1: {"keep": True, "dup": 0, "title_ko": "새 모델", "summary": "s", "kind": "새 모델", "importance": 4}}
        first = self.run_news(files, [article], judged)
        self.assertEqual(first.call_count, 1)
        self.assertEqual(files[news.NEWS_PATH]["articles"][0]["card"], {"what": "카드"})
        again = self.run_news(files, [article])
        again.assert_not_called()

    def test_card_failures_are_retried_then_given_up(self):
        article = news.make("New tool", "https://example.test/t", "test", dt.datetime.now(collect.KST))
        files = {}
        judged = {1: {"keep": True, "dup": 0, "title_ko": "새 도구", "summary": "s", "kind": "도구·라이브러리", "importance": 3}}
        self.run_news(files, [article], judged, card=RuntimeError("x"))
        self.run_news(files, [article], card=RuntimeError("x"))
        third = self.run_news(files, [article])
        third.assert_not_called()
        self.assertNotIn("card", files[news.NEWS_PATH]["articles"][0])

    def test_card_fit_level_is_normalized(self):
        a = {"title": "t", "source": "s", "kind": "새 모델", "snippet": ""}
        reply = {"what": "무엇", "fit": "맞음", "fit_level": "높음", "try": {"desc": "", "code": ""}}
        with patch.object(collect, "chat_json", return_value=reply):
            card = news.ai_card(a, "본문", "")
        self.assertEqual(card["fit_level"], "높음")
        self.assertNotIn("try", card)
        with patch.object(collect, "chat_json", return_value={**reply, "fit_level": "매우 높음"}):
            self.assertEqual(news.ai_card(a, "", "")["fit_level"], "")

    def test_blog_cards_need_higher_importance(self):
        blog = news.make("Claude Code 한도 재 봤다", "https://a.tistory.com/1", "블로그 · t",
                         dt.datetime.now(collect.KST), "", "국내 블로그")
        files = {}
        judged = {1: {"keep": True, "dup": 0, "title_ko": "한도 기록", "summary": "s", "kind": "사용법·팁", "importance": 3}}
        ai_card = self.run_news(files, [blog], judged)
        ai_card.assert_not_called()

    def test_it_news_cards_need_higher_importance(self):
        item = news.make("PHP security release", "https://php.test", "GeekNews", dt.datetime.now(collect.KST))
        files = {}
        judged = {1: {"keep": True, "dup": 0, "title_ko": "PHP 보안 릴리스", "summary": "s", "kind": news.IT_KIND, "importance": 3}}
        ai_card = self.run_news(files, [item], judged)
        ai_card.assert_not_called()
        self.assertEqual(files[news.NEWS_PATH]["articles"][0]["kind"], "IT 소식")

    def test_old_format_news_is_replaced(self):
        old = {"id": "old1", "title": "투자 소식", "link": "https://example.test/o", "source": "x",
               "published": dt.datetime.now(collect.KST).isoformat(timespec="minutes"),
               "ai": True, "topic": "기업·투자", "importance": 5}
        files = {news.NEWS_PATH: {"topics": ["기업·투자"], "articles": [old], "brief": {"date": "x"}}}
        self.run_news(files, [])
        saved = files[news.NEWS_PATH]
        self.assertEqual(saved["articles"], [])
        self.assertEqual(saved["kinds"], news.KINDS)
        self.assertIsNone(saved["brief"])


class KoBlogTests(unittest.TestCase):
    def doc(self, title, url, contents="Claude Code를 직접 써 본 기록", when="2026-10-22T09:00:00.000+09:00"):
        return {"title": title, "url": url, "contents": contents, "datetime": when, "blogname": "개발 일지"}

    def test_without_key_the_source_is_skipped(self):
        with patch.dict(os.environ, {"KAKAO_REST_API_KEY": ""}):
            self.assertIsNone(news.ko_blogs(30))

    def test_mechanical_filters_and_naver_body_url(self):
        docs = [
            self.doc("<b>Claude Code</b>와 서브에이전트 워크플로 짜는 법", "https://a.tistory.com/9"),
            self.doc("클로드 코드 권한 모드 정리", "https://blog.naver.com/someone/224246149312",
                     when="2026-10-22T10:00:00.000+09:00"),
            self.doc("주식 시장 오늘 흐름", "https://b.tistory.com/1"),               # 제목에 검색어 없음
            self.doc("2026-10-22 AI Developer Brief: Claude Code", "https://c.tistory.com/2"),  # 소식 모음
            self.doc("Claude Code 사용기", "https://d.tistory.com/3", contents="소정의 원고료를 받아 작성"),  # 협찬
            self.doc("Claude Code 확장 추천 7가지", "https://e.tistory.com/4"),          # 목록 글
            self.doc("Codex 사용법 완벽 가이드", "https://f.tistory.com/5"),             # 안내 글
        ]
        body = json.dumps({"documents": docs})
        with patch.dict(os.environ, {"KAKAO_REST_API_KEY": "k"}), \
                patch.object(news.core, "http_get", return_value=(body, {})) as get:
            out = news.ko_blogs(30)
        self.assertEqual(get.call_count, len(news.KO_BLOG_QUERIES))
        self.assertEqual([a["link"] for a in out],
                         ["https://blog.naver.com/someone/224246149312", "https://a.tistory.com/9"])
        self.assertEqual(out[0]["body_url"],
                         "https://m.blog.naver.com/PostView.naver?blogId=someone&logNo=224246149312")
        self.assertEqual(out[1]["source"], "블로그 · 개발 일지")
        self.assertEqual(out[1]["title"], "Claude Code와 서브에이전트 워크플로 짜는 법")

    def test_naver_paragraphs_are_used_as_body(self):
        page = ('<div class="menu">메뉴</div><p class="se-text-paragraph se-text-paragraph-align-">첫 문단</p>'
                '<p class="se-text-paragraph">둘째 <b>문단</b></p>')
        a = {"id": "x", "source": "블로그 · t", "link": "https://blog.naver.com/a/1",
             "body_url": "https://m.blog.naver.com/PostView.naver?blogId=a&logNo=1"}
        with patch.object(news.core, "http_get", return_value=(page, {"Content-Type": "text/html"})):
            self.assertEqual(news.fetch_body(a), "첫 문단 둘째 문단")


class CollectorTests(unittest.TestCase):
    def run_collector(self, api_result, trending=False, fatal_digest=False, budget=False):
        today = collect.today_kst().isoformat()
        yesterday = (collect.today_kst() - dt.timedelta(days=1)).isoformat()
        files = {
            collect.META_PATH: {"acme/tool": {"full_name": "acme/tool", "stars": 100,
                                             "fetched": today, "release": None}},
            collect.HISTORY_PATH: {"acme/tool": {yesterday: 100}},
        }
        output = {}
        item = {"full_name": "acme/tool", "stars": 110, "forks": 1, "gained": 10}
        hn = {"full_name": "acme/tool", "points": 50, "comments": 2,
              "title": "test", "hn_url": "https://example.test"}

        def read(path, default):
            if path.endswith("acme__tool.json"):
                return {"summary": {"one_liner": "test"}}
            return output.get(path, files.get(path, default))  # 이번 실행에서 쓴 파일은 쓴 내용을 읽는다

        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, {
                "GITHUB_TOKEN": "mock", "GH_TOKEN": "", "ANTHROPIC_API_KEY": "mock",
                "DEEP_PER_RUN": "0", "MAX_SUMMARIES": "60",
            }))
            stack.enter_context(patch.object(collect, "load_dotenv"))
            stack.enter_context(patch.object(collect, "read_json", side_effect=read))
            for name in ("write_json", "write_json_lines"):
                stack.enter_context(patch.object(collect, name,
                                                side_effect=lambda p, d: output.update({p: d})))
            stack.enter_context(patch.object(collect, "fetch_trending",
                                            return_value=[item] if trending else []))
            stack.enter_context(patch.object(collect, "fetch_new_repos", return_value=[]))
            stack.enter_context(patch.object(collect, "fetch_topic_repos", return_value=[]))
            stack.enter_context(patch.object(collect, "fetch_hn", return_value=[hn]))
            api = stack.enter_context(patch.object(collect.GitHub, "api", return_value=api_result))
            digest = stack.enter_context(patch.object(collect, "make_digest",
                side_effect=collect.AIFatal("mock invalid key") if fatal_digest else None,
                return_value={"headline": "test", "themes": []}))
            news_run = stack.enter_context(patch.object(
                news, "run", return_value=collect.BUDGET_PREFIX + "에 닿았습니다" if budget else ""))
            deep_run = stack.enter_context(patch.object(deep, "run", return_value=""))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            if fatal_digest:
                with self.assertRaises(SystemExit) as error:
                    collect.main()
                self.assertEqual(error.exception.code, 1)
                news_run.assert_not_called()
                deep_run.assert_not_called()
            else:
                collect.main()
            digest.assert_called_once()
        return output, api.call_count, today

    def test_hn_stars_are_refreshed_even_with_recent_metadata(self):
        files, calls, today = self.run_collector(
            {"full_name": "acme/tool", "stargazers_count": 120})
        self.assertGreater(calls, 0)
        self.assertEqual(files[collect.INDEX_PATH]["repos"]["acme/tool"]["stars"], 120)
        self.assertEqual(files[collect.HISTORY_PATH]["acme/tool"][today], 120)
        self.assertEqual(files[collect.INDEX_PATH]["repos"]["acme/tool"]["growth"]["d1"], 20)

    def test_failed_hn_refresh_does_not_record_cached_stars(self):
        files, calls, today = self.run_collector(None)
        self.assertGreater(calls, 0)
        self.assertEqual(files[collect.INDEX_PATH]["repos"]["acme/tool"]["stars"], 100)
        self.assertNotIn(today, files[collect.HISTORY_PATH]["acme/tool"])
        self.assertIsNone(files[collect.INDEX_PATH]["repos"]["acme/tool"]["growth"]["d1"])

    def test_trending_stars_are_recorded_without_refreshing_metadata(self):
        files, calls, today = self.run_collector(None, trending=True)
        self.assertEqual(calls, 0)
        self.assertEqual(files[collect.HISTORY_PATH]["acme/tool"][today], 110)

    def test_fatal_digest_error_is_saved_and_exits_with_failure(self):
        files, _, _ = self.run_collector(None, trending=True, fatal_digest=True)
        self.assertEqual(files[collect.INDEX_PATH]["ai_error"], "mock invalid key")
        self.assertIn("acme/tool", files[collect.INDEX_PATH]["repos"])

    def test_monthly_budget_is_reported_but_not_a_failure(self):
        files, _, _ = self.run_collector(None, trending=True, budget=True)  # SystemExit 없이 끝나야 한다
        self.assertTrue(collect.is_budget_error(files[collect.INDEX_PATH]["ai_error"]))


class RequestTests(unittest.TestCase):
    def test_only_owner_requests_are_accepted(self):
        issues = [{"number": i, "title": "deep: acme/tool", "author_association": association}
                  for i, association in enumerate(
                      ("OWNER", "MEMBER", "COLLABORATOR", "CONTRIBUTOR", "NONE"), 1)]
        issues.append({"number": 6, "title": "deep: acme/tool", "author_association": "OWNER",
                       "pull_request": {}})
        gh = collect.GitHub("mock")
        with patch.dict(os.environ, {"GITHUB_REPOSITORY": "owner/site"}), \
                patch.object(gh, "api", return_value=issues):
            self.assertEqual(deep.pending_requests(gh), [(1, "acme/tool")])


class UsageTests(unittest.TestCase):
    """월 AI 토큰 상한(2026-10-27): 호출마다 usage를 누적하고, 상한에 닿으면 부르지 않는다."""

    def setUp(self):
        self.files = {}
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.dict(os.environ, {"ANTHROPIC_API_KEY": "mock", "AI_MONTHLY_TOKENS": "1000"}))
        stack.enter_context(patch.object(collect, "read_json", side_effect=lambda p, d: self.files.get(p, d)))
        stack.enter_context(patch.object(collect, "write_json", side_effect=lambda p, d: self.files.update({p: d})))

    def client(self, *tokens):
        client = MagicMock()
        replies = []
        for t in tokens:
            reply = claude_reply('{"ok": true}')
            reply.usage.input_tokens, reply.usage.output_tokens, reply.usage.cache_read_input_tokens = t, 0, 0
            replies.append(FakeStream(reply))
        client.beta.messages.stream.side_effect = replies
        return patch.object(collect.anthropic, "Anthropic", return_value=client), client

    def test_usage_is_added_per_call(self):
        patcher, _ = self.client(300, 200, 50)
        with patcher:
            collect.chat_json("s", "u", collect.DIGEST_SCHEMA, kind="digest")
            collect.chat_json("s", "u", collect.DIGEST_SCHEMA, kind="digest")
            collect.chat_json("s", "u", collect.DIGEST_SCHEMA)
        month = self.files[collect.AI_USAGE_PATH][collect._month_kst()]
        self.assertEqual(month, {"tokens": 550, "calls": 3,
                                 "by_kind": {"digest": {"tokens": 500, "calls": 2}}})

    def test_stops_before_calling_when_limit_is_reached(self):
        self.files[collect.AI_USAGE_PATH] = {collect._month_kst(): {"tokens": 1000, "calls": 3}}
        patcher, client = self.client()
        with patcher:
            with self.assertRaises(collect.AIFatal) as err:
                collect.chat_json("s", "u", collect.DIGEST_SCHEMA)
        client.beta.messages.stream.assert_not_called()
        self.assertTrue(collect.is_budget_error(str(err.exception)))

    def test_model_and_effort_can_be_given_per_call(self):
        patcher, client = self.client(10)
        with patcher:
            collect.chat_json("s", "u", collect.DIGEST_SCHEMA, model="m-deep", effort="high")
        sent = client.beta.messages.stream.call_args.kwargs
        self.assertEqual(sent["model"], "m-deep")
        self.assertEqual(sent["output_config"]["effort"], "high")


class GrowthTests(unittest.TestCase):
    """급상승(2026-11-14): 오래된 기록과 비교해 며칠치 증가를 '어제보다'로 보이지 않게 한다."""
    today = dt.date(2026, 11, 14)

    def test_daily_growth_needs_yesterdays_record(self):
        self.assertEqual(collect.growth_of({"2026-11-13": 100, "2026-11-14": 150}, self.today, 1), 50)
        self.assertIsNone(collect.growth_of({"2026-11-12": 100, "2026-11-14": 150}, self.today, 1))
        self.assertIsNone(collect.growth_of({"2026-10-20": 10, "2026-11-14": 5000}, self.today, 1))

    def test_weekly_growth_allows_a_short_gap(self):
        self.assertEqual(collect.growth_of({"2026-11-05": 100, "2026-11-14": 300}, self.today, 7), 200)
        self.assertIsNone(collect.growth_of({"2026-11-01": 100, "2026-11-14": 300}, self.today, 7))


class RateLimitTests(unittest.TestCase):
    """GitHub 403(2026-11-14): 한도일 때만 그 실행의 core API를 멈춘다."""

    def error(self, code, remaining=None, body=b""):
        headers = {"X-RateLimit-Remaining": remaining} if remaining is not None else {}
        return collect.urllib.error.HTTPError("https://api.github.com/x", code, "x", headers, io.BytesIO(body))

    def test_blocked_repository_does_not_stop_other_calls(self):
        gh = collect.GitHub("mock")
        with patch.object(collect, "http_get", side_effect=self.error(403, "4000", b'{"message":"Repository access blocked"}')), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertIsNone(gh.api("/repos/bad/repo"))
        self.assertFalse(gh.core_blocked)

    def test_rate_limit_stops_core_calls(self):
        for err in (self.error(403, "0"), self.error(403, None, b"API rate limit exceeded"), self.error(429)):
            gh = collect.GitHub("mock")
            with patch.object(collect, "http_get", side_effect=err), contextlib.redirect_stdout(io.StringIO()):
                gh.api("/repos/a/b")
            self.assertTrue(gh.core_blocked)


if __name__ == "__main__":
    unittest.main()
