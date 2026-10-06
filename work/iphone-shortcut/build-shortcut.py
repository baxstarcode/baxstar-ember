#!/usr/bin/env python3
"""Build a credential-free Apple Shortcut source. Native import is PROVISIONAL.

Python's plist parser validates structure; it cannot validate Apple's runtime.
Sign only the blank template on a Mac. Enter credentials after importing it.
"""
import pathlib
import plistlib
import uuid

ROOT = pathlib.Path(__file__).resolve().parent
NAMESPACE = uuid.UUID("e6fe9666-2430-454a-af05-e0261c252fe4")


def uid(label):
    return str(uuid.uuid5(NAMESPACE, label)).upper()


def output(label, name):
    return {"WFSerializationType": "WFTextTokenAttachment", "Value": {
        "Type": "ActionOutput", "OutputUUID": uid(label), "OutputName": name}}


def text(value):
    if isinstance(value, dict):
        return {"WFSerializationType": "WFTextTokenString", "Value": {
            "string": "\ufffc", "attachmentsByRange": {"{0, 1}": value["Value"]}}}
    return {"WFSerializationType": "WFTextTokenString", "Value": {"string": value}}


def dictionary(items):
    return {"WFSerializationType": "WFDictionaryFieldValue", "Value": {
        "WFDictionaryFieldValueItems": [
            {"WFKey": text(key), "WFItemType": 0, "WFValue": text(value)}
            for key, value in items.items()]}}


def build():
    actions = []

    def action(identifier, label, **params):
        actions.append({"WFWorkflowActionIdentifier": "is.workflow.actions." + identifier,
                        "WFWorkflowActionParameters": {"UUID": uid(label), **params}})
        return len(actions) - 1

    def branch(label, mode, value=None):
        params = {"GroupingIdentifier": uid("group-" + label), "WFControlFlowMode": mode}
        if value is not None:
            params.update(WFCondition=100, WFInput={"Type": "Variable", "Variable": value})
        action("conditional", label + "-" + str(mode), **params)

    def require(label, value, message):
        branch(label, 0, value)
        branch(label, 1)
        action("showresult", label + "-notice", Text=message)
        action("exit", label + "-stop")
        branch(label, 2)

    action("comment", "intro", WFCommentActionText=
           "Talk to Ember — one question per run. Tap Done after speaking. "
           "Setup is incomplete until the protected /api/voice route is enabled. "
           "Enter only the dedicated phone service token below. Never share a configured copy.")
    id_index = action("gettext", "client-id", WFTextActionText="", CustomOutputName="Phone access ID")
    secret_index = action("gettext", "client-secret", WFTextActionText="", CustomOutputName="Phone access secret")
    access_id = output("client-id", "Phone access ID")
    access_secret = output("client-secret", "Phone access secret")
    require("id-ready", access_id, "Talk to Ember needs its phone access ID. Finish shortcut setup first.")
    require("secret-ready", access_secret, "Talk to Ember needs its phone access secret. Finish shortcut setup first.")
    action("dictatetext", "dictation", WFDictateTextStopListening="On Tap", WFSpeechLanguage="en-US")
    question = output("dictation", "Dictated Text")
    require("has-question", question, "I didn't hear a question. Tap Talk to Ember and try again.")
    action("downloadurl", "request", WFURL="https://ember.baxstarfishing.com/api/voice",
           WFHTTPMethod="POST", WFHTTPBodyType="JSON", ShowHeaders=True,
           WFHTTPHeaders=dictionary({"CF-Access-Client-Id": access_id,
                                     "CF-Access-Client-Secret": access_secret,
                                     "Content-Type": "application/json"}),
           WFJSONValues=dictionary({"text": question}))
    result = output("request", "Contents of URL")
    for key in ["reply", "speech", "audio_base64"]:
        action("getvalueforkey", key, WFInput=result, WFGetDictionaryValueType="Value", WFDictionaryKey=key)
    audio = output("audio_base64", "Dictionary Value")
    branch("has-audio", 0, audio)
    action("base64encode", "decode", WFInput=audio, WFEncodeMode="Decode")
    action("setitemname", "mp3", WFInput=output("decode", "Base64 Encoded"),
           WFName="Ember-reply.mp3", WFDontIncludeFileExtension=False)
    action("playsound", "play", WFInput=output("mp3", "Renamed Item"))
    branch("has-audio", 1)
    action("speaktext", "native-speech", WFText=text(output("speech", "Dictionary Value")),
           WFSpeakTextLanguage="en-US", WFSpeakTextWait=True)
    branch("has-audio", 2)
    action("showresult", "show-reply", Text=text(output("reply", "Dictionary Value")))
    questions = [{"ActionIndex": index, "Category": "Parameter", "DefaultValue": "",
                  "ParameterKey": "WFTextActionText", "Text": prompt}
                 for index, prompt in [(id_index, "Dedicated Ember phone service token: Client ID"),
                                       (secret_index, "Dedicated Ember phone service token: Client Secret (keep private)")]]
    return {"WFWorkflowName": "Talk to Ember", "WFWorkflowActions": actions,
            "WFWorkflowClientVersion": "3036.0.4.2", "WFWorkflowMinimumClientVersion": 900,
            "WFWorkflowMinimumClientVersionString": "900", "WFWorkflowTypes": [],
            "WFWorkflowInputContentItemClasses": [], "WFWorkflowOutputContentItemClasses": [],
            "WFWorkflowHasShortcutInputVariables": False,
            "WFWorkflowImportQuestions": questions,
            "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4251333119, "WFWorkflowIconGlyphNumber": 59511}}


if __name__ == "__main__":
    path = ROOT / "Talk-to-Ember.unsigned.shortcut"
    path.write_bytes(plistlib.dumps(build(), fmt=plistlib.FMT_XML, sort_keys=False))
    print(f"Wrote {path.name}; unsigned, no credentials, native import unverified.")
