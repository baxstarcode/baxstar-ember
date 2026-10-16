#!/usr/bin/env python3
"""Validate the exported artifact and variable links, not Apple's native runtime."""
import importlib.util
import pathlib
import plistlib

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("builder", ROOT / "build-shortcut.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
raw = (ROOT / "Talk-to-Ember.unsigned.shortcut").read_bytes()
workflow = plistlib.loads(raw)
assert workflow == builder.build(), "Regenerate the shortcut; source and artifact differ"
assert raw == plistlib.dumps(workflow, fmt=plistlib.FMT_XML, sort_keys=False), "Plist does not round-trip"
actions = workflow["WFWorkflowActions"]
seen, groups = set(), []


def references(value):
    if isinstance(value, dict):
        if value.get("Type") == "ActionOutput":
            yield value["OutputUUID"]
        for item in value.values():
            yield from references(item)
    elif isinstance(value, list):
        for item in value:
            yield from references(item)


for action in actions:
    params = action["WFWorkflowActionParameters"]
    for reference in references(params):
        assert reference in seen, f"Missing or forward action reference: {reference}"
    identifier = params["UUID"]
    assert identifier not in seen, "Duplicate action UUID"
    seen.add(identifier)
    if action["WFWorkflowActionIdentifier"].endswith(".conditional"):
        mode, group = params["WFControlFlowMode"], params["GroupingIdentifier"]
        if mode == 0:
            groups.append(group)
        else:
            assert groups and groups[-1] == group, "Unbalanced conditional"
            if mode == 2:
                groups.pop()
assert not groups, "Unclosed conditional"
questions = workflow["WFWorkflowImportQuestions"]
assert len(questions) == 2
for question in questions:
    setup = actions[question["ActionIndex"]]["WFWorkflowActionParameters"]
    assert setup[question["ParameterKey"]] == question["DefaultValue"] == "", "Credentials must be blank"
downloads = [a for a in actions if a["WFWorkflowActionIdentifier"].endswith(".downloadurl")]
assert len(downloads) == 1, "Only one network destination is permitted"
assert downloads[0]["WFWorkflowActionParameters"]["WFURL"] == "https://ember.baxstarfishing.com/api/voice"
print(f"PASS: {len(actions)} actions; round-trip, import questions, variable links, branches and blank credentials.")
print("Apple signing, import, dictation and playback remain PROVISIONAL.")
