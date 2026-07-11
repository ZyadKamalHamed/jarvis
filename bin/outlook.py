#!/usr/bin/env python3
"""Outlook personal (zyad2408@live.com.au) bridge via Microsoft Graph.

Setup (one time, about 5 minutes):
  1. pip install msal
  2. portal.azure.com > Microsoft Entra ID > App registrations > New registration
       Name: JARVIS
       Supported account types: "Personal Microsoft accounts only"
       Redirect URI: leave blank
     Then in the app: Authentication > Advanced settings > Allow public client flows > Yes
  3. Copy the Application (client) ID into ~/Coding/JARVIS/.env as OUTLOOK_CLIENT_ID=...
  4. python3 bin/outlook.py login   (enter the code at microsoft.com/devicelogin, sign in as zyad2408@live.com.au)

After that the refresh token lives in .cache/msal_cache.json and every run is headless:
  python3 bin/outlook.py fetch     prints the last 24h of inbox as triage JSON

No passwords are ever stored. Tenant must stay "consumers" for a live.com.au account.
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "msal_cache.json"
SCOPES = ["Mail.Read"]
# login --send consents to these; incremental consent on the same client id
# upgrades the cached refresh token, and plain Mail.Read fetches keep working.
SEND_SCOPES = ["Mail.Read", "Mail.ReadWrite", "Mail.Send"]
AUTHORITY = "https://login.microsoftonline.com/consumers"


def load_env():
    env = {}
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def get_app():
    try:
        import msal
    except ImportError:
        sys.exit("msal not installed. Run: pip3 install msal")
    client_id = load_env().get("OUTLOOK_CLIENT_ID") or os.environ.get("OUTLOOK_CLIENT_ID")
    if not client_id:
        sys.exit("OUTLOOK_CLIENT_ID missing from .env. See the setup steps at the top of this file.")
    CACHE.parent.mkdir(exist_ok=True)
    cache = msal.SerializableTokenCache()
    if CACHE.exists():
        cache.deserialize(CACHE.read_text())
    app = msal.PublicClientApplication(client_id, authority=AUTHORITY, token_cache=cache)
    return app, cache


def save_cache(cache):
    if cache.has_state_changed:
        CACHE.write_text(cache.serialize())
        os.chmod(CACHE, 0o600)


def get_token(interactive, scopes=SCOPES):
    app, cache = get_app()
    accounts = app.get_accounts()
    if accounts:
        result = app.acquire_token_silent(scopes, account=accounts[0])
        if result and "access_token" in result:
            save_cache(cache)
            return result["access_token"]
    if not interactive:
        sys.exit("No cached login. Run: python3 bin/outlook.py login")
    flow = app.initiate_device_flow(scopes=scopes)
    if "user_code" not in flow:
        sys.exit("Device flow failed: " + json.dumps(flow))
    print(flow["message"])  # go to microsoft.com/devicelogin, enter the code
    result = app.acquire_token_by_device_flow(flow)
    if "access_token" not in result:
        sys.exit("Login failed: " + result.get("error_description", json.dumps(result)))
    save_cache(cache)
    return result["access_token"]


def graph(path, token):
    req = urllib.request.Request(
        "https://graph.microsoft.com/v1.0" + path,
        headers={"Authorization": "Bearer " + token},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def fetch():
    token = get_token(interactive=False)
    data = graph(
        "/me/mailFolders/inbox/messages"
        "?$top=15&$orderby=receivedDateTime%20desc"
        "&$select=from,subject,bodyPreview,receivedDateTime,isRead",
        token,
    )
    threads = []
    unread = 0
    for m in data.get("value", []):
        if not m.get("isRead"):
            unread += 1
        threads.append({
            "from": (m.get("from", {}).get("emailAddress", {}) or {}).get("name", "unknown"),
            "subject": m.get("subject", ""),
            "preview": (m.get("bodyPreview", "") or "")[:200],
            "received": m.get("receivedDateTime", ""),
            "read": bool(m.get("isRead")),
        })
    print(json.dumps({"address": "zyad2408@live.com.au", "unread": unread, "messages": threads}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "fetch"
    if cmd == "login":
        scopes = SEND_SCOPES if "--send" in sys.argv[2:] else SCOPES
        get_token(interactive=True, scopes=scopes)
        extra = " Draft and send scopes granted." if scopes is SEND_SCOPES else ""
        print("Login cached. Headless fetches will work now." + extra)
    elif cmd == "fetch":
        fetch()
    else:
        sys.exit("usage: outlook.py [login [--send]|fetch]")
