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
                      "summary": "test", "topic": "기타", "importance": 3}}
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
