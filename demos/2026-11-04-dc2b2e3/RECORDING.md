# Paused variable hover demo

Recorded from plugin commit `dc2b2e3391e4682bc37ae14a722005b6ea998b16` on `feat/debug-variable-hover`, served from the local dsh-git-control worktree by official DeepSeek Harness 0.2.1-rc.5 at `http://127.0.0.1:58097`. The client was built with `npm run build`.

The fictional sample-shop project runs the included `hover_demo.py` through real debugpy 1.8.22. No model round, mock API, synthetic DOM event, or fixture transport was used. The isolated test Harness profile and existing sample conversation were reused; this port had fresh browser storage. Fullscreen workbench mode hides conversation history. All four screenshots come from the same debug process.

The GIF is a screenshot storyboard, not a latency recording: paused (1.5 s), path value (2.5 s), expanded args object (4 s), and next paused line with the popup dismissed (2 s). Every capture uses the same 1275×610 crop, excluding the absolute workspace path. The encoder scales to 1200×574, 128 colors, 10 fps, 100 encoded frames, 10 s, 257253 bytes. The PNG is the original expanded-object capture.

`debug-hover-light.png` is a separate light-theme verification capture from the same isolated Host and sample project after restarting the debugger. It is not included in the four-frame GIF.
