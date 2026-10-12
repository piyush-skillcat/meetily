# Linux e2e harness (tauri-driver)

Drives the real debug app through WebDriver to check that a recording survives a full
session with audio playing through the system-audio monitor.

Requirements: `tauri-driver` (cargo install tauri-driver), `WebKitWebDriver` (webkit2gtk),
`espeak-ng`, `paplay`/`pactl`, a running Next dev server on port 3118, and a debug build
(`cargo build` in `src-tauri`). The app window opens on your desktop while it runs; do not
click in it.

```bash
./make_them_wav.sh                      # once
python3 e2e_autostop.py run1 45         # label, seconds to record
```

Exit 0 = green. Exit 1 = red, with the symptom, per-second samples, every click
(`trusted=true` means a real pointer or key, `false` means scripted), console errors and the
backend log in `autostop-driver-<label>.log`. Each run leaves one meeting folder under
`~/Documents/meetily-recordings`; delete it afterwards. `MEETILY_APP` overrides the binary.

`wd.py` is a minimal stdlib WebDriver client reused by ad-hoc scripts.
