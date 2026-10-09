import contextlib
import datetime as dt
import io
import os
import unittest
from unittest.mock import patch

import collect
import deep
import news


class NewsTests(unittest.TestCase):
    def test_missing_results_remain_pending_and_can_be_retried(self):
        article = news.make("AI launch", "https://example.test", "test",
                            dt.datetime.now(collect.KST))
        files = {}
        result = {1: {"keep": True, "dup": 0, "title_ko": "AI launch",
                      "summary": "test", "kind": "업계 흐름", "importance": 2}}
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, {"OPENAI_API_KEY": "mock"}))
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
        with patch.dict(os.environ, {"OPENAI_API_KEY": "mock"}), \
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
            stack.enter_context(patch.dict(os.environ, {"OPENAI_API_KEY": "mock"}))
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


class CollectorTests(unittest.TestCase):
    def run_collector(self, api_result, trending=False, fatal_digest=False):
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
            return files.get(path, default)

        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, {
                "GITHUB_TOKEN": "mock", "GH_TOKEN": "", "OPENAI_API_KEY": "mock",
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
            stack.enter_context(patch.object(collect, "fetch_hn", return_value=[hn]))
            api = stack.enter_context(patch.object(collect.GitHub, "api", return_value=api_result))
            digest = stack.enter_context(patch.object(collect, "make_digest",
                side_effect=collect.AIFatal("mock invalid key") if fatal_digest else None,
                return_value={"headline": "test", "themes": []}))
            news_run = stack.enter_context(patch.object(news, "run", return_value=""))
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


if __name__ == "__main__":
    unittest.main()
