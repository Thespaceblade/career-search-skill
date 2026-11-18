#!/usr/bin/env python3
"""Serve the same workspace in a browser or the optional Electron window."""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from uuid import uuid4

from store import ROOT, WORKSPACE, display_job, edit_job, log, read, transaction, write

ASSETS = {
    "/": ("index.html", "text/html"), "/dashboard.css": ("dashboard.css", "text/css"),
    "/dashboard.js": ("dashboard.js", "application/javascript"),
    "/workspace.js": ("workspace.js", "application/javascript"),
    "/chart.js": ("vendor/chart.umd.js", "application/javascript"),
}
PROFILE_FIELDS = ("name", "roles", "locations", "arrangement", "graduation", "availability",
                  "authorization", "compensation", "constraints")
CONTACT_FIELDS = ("company", "name", "channel", "state", "conversation", "meeting",
                  "referral", "mechanism", "draft", "due", "url", "notes")


class Handler(BaseHTTPRequestHandler):
    @property
    def host(self):
        return f"127.0.0.1:{self.server.server_port}"

    def reply(self, code, content, kind="application/json"):
        body = json.dumps(content).encode() if kind == "application/json" else content
        self.send_response(code)
        self.send_header("Content-Type", kind + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.headers.get("Host") != self.host:
            return self.reply(403, {"error": "Use the localhost address printed by the server."})
        if self.path in ASSETS:
            filename, kind = ASSETS[self.path]
            return self.reply(200, (ROOT / "dashboard" / filename).read_bytes(), kind)
        if self.path == "/api/workspace":
            try:
                return self.reply(200, workspace_data())
            except (ValueError, OSError, KeyError, TypeError):
                return self.reply(500, {"error": "Could not read workspace data. Check the private files or rerun setup."})
        self.reply(404, {"error": "Page not found."})

    def do_POST(self):
        if (self.headers.get("Host") != self.host
                or self.headers.get("Origin") != f"http://{self.host}"
                or self.headers.get_content_type() != "application/json"):
            return self.reply(403, {"error": "Open the dashboard locally before saving."})
        try:
            size = int(self.headers.get("Content-Length", 0))
            if not 0 < size <= 192_000:
                raise ValueError("Invalid request size.")
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError("Expected an object.")
            if self.path == "/api/job":
                return self.reply(200, edit_job(data))
            if self.path == "/api/profile":
                fields = text_fields(data, PROFILE_FIELDS)
                with transaction():
                    write("profile.json", {**read("profile.json"), **fields})
                    log("profile", "Preferences updated")
                return self.reply(200, {"ok": True})
            if self.path == "/api/contact":
                fields = text_fields(data, CONTACT_FIELDS)
                if not fields["name"] or not fields["company"] or fields["channel"] not in {"linkedin", "email"}:
                    raise ValueError("Name, company and channel are required.")
                with transaction():
                    contacts = read("contacts.json")
                    contact = next((row for row in contacts if row["id"] == data.get("id")), None)
                    if contact is None:
                        contact = {"id": str(uuid4())}
                        contacts.append(contact)
                    contact.update(fields)
                    write("contacts.json", contacts)
                    log("networking", "Contact saved")
                return self.reply(200, {"ok": True})
            return self.reply(404, {"error": "Endpoint not found."})
        except (ValueError, TypeError) as exc:
            self.reply(400, {"error": str(exc)})
        except (OSError, KeyError):
            self.reply(500, {"error": "Could not save workspace data."})


def text_fields(data, fields):
    result = {}
    for field in fields:
        value = data.get(field, "")
        if not isinstance(value, str) or len(value) > 5000:
            raise ValueError(f"Invalid {field}.")
        result[field] = value.strip()
    return result


def workspace_data():
    summary = {}
    if (WORKSPACE / "discovery.json").exists():
        discovery = read("discovery.json")
        summary = {"checked": discovery["checked"], "count": len(discovery["candidates"]),
                   "errors": len(discovery["errors"])}
    return {
        "discovery": summary,
        "jobs": [display_job(row) for row in read("jobs.json")],
        "profile": read("profile.json"), "contacts": read("contacts.json"),
        "activity": read("activity.json")[-50:][::-1],
        "sources": [{key: value for key, value in row.items() if key in ("kind", "company", "board")}
                    for row in read("sources.json")],
        "resumeCount": sum(path.is_file() for path in (WORKSPACE / "resume").iterdir()),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", default=8765, type=int, help="Use 0 to select an available local port.")
    args = parser.parse_args()
    if not (WORKSPACE / "activity.json").exists():
        raise SystemExit("Run python3 scripts/setup.py first.")
    with ThreadingHTTPServer(("127.0.0.1", args.port), Handler) as server:
        print(f"http://127.0.0.1:{server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
