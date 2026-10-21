"""Fail-closed JUnit evidence for the pinned contracts suite (stdlib only)."""
import argparse
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import PurePosixPath


def normalize_file(value):
    if not isinstance(value, str) or not value or "\0" in value:
        raise ValueError()
    value = value.replace("\\", "/")
    if value.startswith("/") or re.match(r"^[A-Za-z]:", value) or ".." in value.split("/"):
        raise ValueError()
    path = str(PurePosixPath(value))
    if path == ".":
        raise ValueError()
    return path


def evaluate(junit_path, expected_files_json):
    def fail(reason):
        return {"ok": False, "reason": reason}

    try:
        with open(expected_files_json, encoding="utf-8") as stream:
            expected = json.load(stream)
        if not isinstance(expected, list) or not all(isinstance(item, str) for item in expected):
            return fail("invalid_expected_files")
        expected_files = {normalize_file(item) for item in expected}
        if not expected_files or len(expected_files) != len(expected):
            return fail("invalid_expected_files")
    except Exception:
        return fail("invalid_expected_files")

    try:
        with open(junit_path, "rb") as stream:
            xml = stream.read(16 * 1024 * 1024 + 1)
        if len(xml) > 16 * 1024 * 1024:
            return fail("junit_xml_too_large")
        root = ET.fromstring(xml)
    except OSError:
        return fail("missing_junit_xml")
    except Exception:
        return fail("invalid_junit_xml")

    if root.tag not in ("testsuites", "testsuite"):
        return fail("invalid_junit_xml")
    testcases = list(root.iter("testcase"))
    if any(child.tag in ("failure", "error", "skipped") for tc in testcases for child in tc):
        return fail("testcase_not_passed")
    suites = list(root.iter("testsuite"))
    if not suites:
        return fail("invalid_suite_totals")
    for suite in suites:
        count = len(list(suite.iter("testcase")))
        if suite.get("tests") != str(count):
            return fail("invalid_suite_totals")
        if any(suite.get(key, "0") != "0" for key in ("errors", "failures", "skipped")):
            return fail("invalid_suite_totals")
    if root.tag == "testsuites" and root.get("tests") is not None and root.get("tests") != str(len(testcases)):
        return fail("invalid_suite_totals")

    files, identities = {}, set()
    for tc in testcases:
        try:
            path = normalize_file(tc.get("file"))
        except ValueError:
            return fail("invalid_file_attribute")
        if path not in expected_files:
            return fail("unexpected_file")
        classname, name = tc.get("classname", ""), tc.get("name", "")
        if "\0" in classname or "\0" in name:
            return fail("invalid_case_identity")
        identity = f"{path}\0{classname}\0{name}"
        if identity in identities:
            return fail("duplicate_case_identity")
        identities.add(identity)
        entry = files.setdefault(path, {"path": path, "tests": 0, "passed": 0, "cases": []})
        entry["tests"] += 1
        entry["passed"] += 1
        entry["cases"].append({"case_sha256": hashlib.sha256(identity.encode("utf-8")).hexdigest(), "status": "passed"})
    if any(path not in files for path in expected_files):
        return fail("missing_or_empty_file")
    return {"ok": True, "reason": "tests_executed", "files": sorted(files.values(), key=lambda entry: entry["path"]), "total": len(testcases)}


class NoDoctypeTreeBuilder(ET.TreeBuilder):
    def doctype(self, name, pubid, system):
        # Reject declarations before any internal or external entity expansion.
        raise ValueError()


def failure_counts(junit_path, expected_files_json):
    """Closed diagnostics only; never pass evidence, even for all-passed XML."""
    def fail():
        return {"ok": False, "reason": "invalid_failure_counts"}

    try:
        with open(expected_files_json, encoding="utf-8") as stream:
            expected = json.load(stream)
        if (not isinstance(expected, list) or not 0 < len(expected) <= 512
                or not all(isinstance(path, str) and normalize_file(path) == path for path in expected)
                or len(set(expected)) != len(expected)):
            return fail()
        with open(junit_path, "rb") as stream:
            xml = stream.read(16 * 1024 * 1024 + 1)
        if len(xml) > 16 * 1024 * 1024:
            return fail()
        root = ET.fromstring(xml, parser=ET.XMLParser(target=NoDoctypeTreeBuilder()))
        suites = [root] if root.tag == "testsuite" else list(root)
        if root.tag not in ("testsuites", "testsuite") or not suites:
            return fail()
        files = {path: dict.fromkeys(("tests", "passed", "failed", "cancelled", "skipped", "todo"), 0)
                 for path in expected}
        identities = set()
        totals = dict.fromkeys(("tests", "failures", "errors", "skipped"), 0)
        for suite in suites:
            if suite.tag != "testsuite" or any(tc.tag not in ("testcase", "properties") for tc in suite):
                return fail()
            counts = dict.fromkeys(totals, 0)
            for tc in suite:
                if tc.tag != "testcase":
                    continue
                path = tc.get("file")
                # Exact membership only: aliases and unknown paths invalidate the
                # entire diagnostic, so unselected cases cannot inflate counts.
                if path not in files:
                    return fail()
                identity = (path, tc.get("classname", ""), tc.get("name", ""))
                if identity in identities:
                    return fail()
                identities.add(identity)
                outcomes = [child.tag for child in tc if child.tag in ("failure", "error", "skipped")]
                if len(outcomes) > 1:
                    return fail()
                outcome = outcomes[0] if outcomes else "passed"
                status = "failed" if outcome in ("failure", "error") else outcome
                files[path]["tests"] += 1
                files[path][status] += 1
                counts["tests"] += 1
                if outcome != "passed":
                    counts[{"failure": "failures", "error": "errors", "skipped": "skipped"}[outcome]] += 1
            if suite.get("tests") != str(counts["tests"]) or any(
                    suite.get(key, "0") != str(counts[key]) for key in ("failures", "errors", "skipped")):
                return fail()
            for key in totals:
                totals[key] += counts[key]
        if root.tag == "testsuites" and any(
                root.get(key) is not None and root.get(key) != str(value) for key, value in totals.items()):
            return fail()
        if totals["tests"] != sum(1 for _ in root.iter("testcase")):
            return fail()
        if any(counts["tests"] == 0 for counts in files.values()):
            return fail()
        return {"ok": False, "reason": "test_process_failed",
                "files": [{"path": path, "counts": files[path]} for path in sorted(files)]}
    except Exception:
        return fail()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--junit", required=True)
    parser.add_argument("--expected", required=True)
    parser.add_argument("--failure-counts", action="store_true")
    args = parser.parse_args()
    result = failure_counts(args.junit, args.expected) if args.failure_counts else evaluate(args.junit, args.expected)
    print(json.dumps(result))
    valid = "files" in result if args.failure_counts else result["ok"]
    sys.exit(0 if valid else 1)


if __name__ == "__main__":
    main()
