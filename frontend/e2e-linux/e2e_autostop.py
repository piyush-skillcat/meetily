"""Recording-survival e2e check (Linux, tauri-driver).

Originally built to chase a suspected auto-stop at 18 s; that turned out to be a manual click.
Kept as a regression loop for the recording flow.

Launches the debug app through tauri-driver, starts a recording, plays them.wav
through the default sink (exactly like the runs that failed), and polls the UI
every second. RED if 'Processing recording...' appears, the timer stops
advancing, or the backend reports is_recording=false before we ask it to stop.

Usage: python3 e2e_autostop.py [run-label] [record-seconds]
Exit code 1 = RED (bug reproduced), 0 = GREEN.
"""
import json, os, re, socket, subprocess, sys, threading, time
from wd import Session

S = os.path.dirname(os.path.abspath(__file__))
LABEL = sys.argv[1] if len(sys.argv) > 1 else "run"
RECORD_SECS = int(sys.argv[2]) if len(sys.argv) > 2 else 45
REPO = os.path.abspath(os.path.join(S, "..", ".."))
APP = os.environ.get("MEETILY_APP", os.path.join(REPO, "target", "debug", "meetily"))
SAVE_PATH = os.path.expanduser("~/.local/share/com.meetily.ai/autostop-test.wav")
DRIVER_LOG = os.path.join(S, f"autostop-driver-{LABEL}.log")

def log(*a):
    print(f"[{time.strftime('%H:%M:%S')}]", *a, flush=True)

def port_open(p):
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", p)) == 0

driver = None
if not port_open(4444):
    driver = subprocess.Popen(["tauri-driver"], stdout=open(DRIVER_LOG, "w"), stderr=subprocess.STDOUT,
                              env={**os.environ, "RUST_LOG": "info"})
    for _ in range(50):
        if port_open(4444): break
        time.sleep(0.2)
    log("tauri-driver started, log ->", DRIVER_LOG)

s = Session(APP)
try:
    time.sleep(12)
    for _ in range(6):
        s.js("location.href='/'"); time.sleep(6)
        if s.js("return !!document.querySelector('.notes-pad')"): break
    log("home loaded, notes-pad:", s.js("return !!document.querySelector('.notes-pad')"))

    # console + click capture
    s.js("""window.__logs=[]; const push=(k,a)=>window.__logs.push(k+' '+(performance.now()/1000).toFixed(1)+' '+a.map(x=>{try{return typeof x==='object'?JSON.stringify(x):String(x)}catch(e){return String(x)}}).join(' ').slice(0,200));
      const ol=console.log.bind(console), ow=console.warn.bind(console), oe=console.error.bind(console);
      console.log=(...a)=>{push('L',a); ol(...a)}; console.warn=(...a)=>{push('W',a); ow(...a)}; console.error=(...a)=>{push('E',a); oe(...a)};
      for (const ev of ['click','pointerdown','keydown']) document.addEventListener(ev, e=>{
        const t=e.target.closest('button,a,[role=button]')||e.target;
        push('EV', [ev, 'trusted='+e.isTrusted, (t.tagName||'')+'.'+String(t.className||'').slice(0,60), 'key='+(e.key||''), 'svg='+(t.querySelector&&t.querySelector('svg')?t.querySelector('svg').getAttribute('class'):'')]);
      }, true);
      window.__t0=performance.now();""")

    s.js("""const ed=document.querySelector('.notes-pad .ProseMirror'); if(ed){ed.focus(); document.execCommand('insertText', false, 'launch plan\\nrelease notes to design');}""")
    time.sleep(1)
    log(s.js("const b=[...document.querySelectorAll('button')].find(b=>b.className.includes('w-12 h-12')); if(!b) return 'no start'; b.click(); return 'start clicked'"))
    t_start = time.time()

    # trigger identical to the failing runs: unmute+60% at t+12, paplay, mute
    def play():
        time.sleep(12)
        subprocess.run(["pactl", "set-sink-mute", "@DEFAULT_SINK@", "0"])
        subprocess.run(["pactl", "set-sink-volume", "@DEFAULT_SINK@", "60%"])
        t0 = time.time(); r = subprocess.run(["paplay", os.path.join(S, "them.wav")], capture_output=True, text=True)
        log(f"paplay done {time.time()-t0:.1f}s rc={r.returncode}")
        subprocess.run(["pactl", "set-sink-mute", "@DEFAULT_SINK@", "1"])
    threading.Thread(target=play, daemon=True).start()

    red = None
    last_timer = -1
    stalled = 0
    samples = []
    while time.time() - t_start < RECORD_SECS:
        time.sleep(1)
        body = s.js("return document.body.innerText")
        m = re.search(r"Recording • (\d\d):(\d\d)", body)
        timer = int(m.group(1)) * 60 + int(m.group(2)) if m else None
        backend = s.js_async("const cb=arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke('is_recording').then(v=>cb(String(v))).catch(e=>cb('ERR '+e))")
        processing = "Processing recording" in body
        samples.append((round(time.time() - t_start), timer, backend, processing))
        if processing:
            red = f"'Processing recording...' shown at t+{round(time.time()-t_start)}s (timer={timer})"; break
        if backend != "true" and time.time() - t_start > 6:
            red = f"backend is_recording={backend} at t+{round(time.time()-t_start)}s (timer={timer})"; break
        if timer is not None and timer == last_timer:
            stalled += 1
            if stalled >= 3:
                red = f"timer stalled at {timer}s for 3 polls (t+{round(time.time()-t_start)}s)"; break
        else:
            stalled = 0
        if timer is not None: last_timer = timer

    log("samples (t, timer, backend, processing):", samples)
    logs = s.js("return window.__logs")
    interesting = [l for l in logs if re.search(r"EV |stop|Stop|error|Error|disconnect|device|transcript-error|Synchroniz|synchroniz|is_recording result", l)]
    log("captured events/logs:\n  " + "\n  ".join(interesting[:80]))
    errs = [l for l in logs if l.startswith('E ')]
    log("console errors:", len(errs), "\n  " + "\n  ".join(errs[:20]))
    log("next overlay:", s.js("const p=document.querySelector('nextjs-portal'); return p&&p.shadowRoot? p.shadowRoot.textContent.slice(0,400):'none'"))
    if red:
        log("RED:", red)
        s.screenshot(os.path.join(S, f"autostop-{LABEL}.png"))
    else:
        log("GREEN: recording survived", RECORD_SECS, "s")

    # controlled stop: fire without awaiting (stop can exceed WebDriver's 30 s script limit), then poll
    s.js("window.__TAURI_INTERNALS__.invoke('stop_recording',{args:{save_path:'" + SAVE_PATH + "'}}).then(()=>{window.__stopped='ok'}).catch(e=>{window.__stopped='err '+e});")
    for _ in range(90):
        time.sleep(2)
        st = s.js("return window.__stopped || ''")
        if st: break
    log("stop result:", st or "timed out waiting for stop_recording")
finally:
    subprocess.run(["pactl", "set-sink-mute", "@DEFAULT_SINK@", "1"])
    s.close()
    if driver:
        time.sleep(1); driver.terminate()
sys.exit(1 if red else 0)
