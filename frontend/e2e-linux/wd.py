"""Minimal W3C WebDriver client for tauri-driver (stdlib only)."""
import json, sys, base64, time, urllib.request

BASE = "http://127.0.0.1:4444"

def _req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())

class Session:
    def __init__(self, app, args=None):
        caps = {"capabilities": {"alwaysMatch": {"tauri:options": {"application": app, "args": args or []}}}}
        r = _req("POST", "/session", caps)
        self.id = r["value"]["sessionId"]
    def p(self, path): return f"/session/{self.id}{path}"
    def js(self, script, *args):
        return _req("POST", self.p("/execute/sync"), {"script": script, "args": list(args)})["value"]
    def js_async(self, script, *args):
        return _req("POST", self.p("/execute/async"), {"script": script, "args": list(args)})["value"]
    def screenshot(self, path):
        b = _req("GET", self.p("/screenshot"))["value"]
        open(path, "wb").write(base64.b64decode(b)); return path
    def url(self): return _req("GET", self.p("/url"))["value"]
    def find(self, css):
        return _req("POST", self.p("/element"), {"using": "css selector", "value": css})["value"]
    def click_text(self, text, tag="button"):
        return self.js("""const t=arguments[0], tag=arguments[1];
            const els=[...document.querySelectorAll(tag)];
            const el=els.find(e=>e.innerText.trim().toLowerCase().includes(t.toLowerCase())||(e.getAttribute('title')||'').toLowerCase().includes(t.toLowerCase()));
            if(!el) return 'NOT FOUND: '+t; el.click(); return 'clicked: '+el.innerText.trim().slice(0,40);""", text, tag)
    def text(self): return self.js("return document.body.innerText")
    def close(self):
        try: _req("DELETE", self.p(""))
        except Exception: pass

if __name__ == "__main__":
    s = Session(sys.argv[1])
    time.sleep(3)
    print(s.url())
    s.screenshot(sys.argv[2] if len(sys.argv) > 2 else "shot.png")
    s.close()
