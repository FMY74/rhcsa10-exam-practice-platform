# RHCSA 10 exam practice platform

A personal study tool for the **Red Hat Certified System Administrator (RHCSA) EX200 on RHEL 10**. It is a browser app that turns hands-on Linux tasks into a drill-and-exam workflow, and — optionally — **grades your work on real practice VMs over SSH**.

This repository is the **engine, published code-only**. The actual question bank and study notes are derived from third-party paid materials and are **deliberately excluded for copyright**. To keep the app explorable, it ships with a small set of **original sample tasks**.

> **Live demo:** https://fmy74.github.io/rhcsa10-exam-practice-platform/app/
> Runs entirely in the browser on the sample tasks (self-assessment mode; no VM needed to look around).

---

## Why it exists

Reading model answers does not build muscle memory for a hands-on exam. This tool is a "command centre" for practising on real VMs: it presents tasks, lets you flip between **Learn** and **Solve** modes, and then **objectively checks whether your changes actually pass** by running verification commands on the VM over SSH — a second opinion on top of self-assessment.

## What's interesting about the build (for reviewers)

- **No framework.** The front end is vanilla HTML/CSS/JS with no build step — data files are plain `<script>`-loaded JS, routing is hash-based, progress is in `localStorage`, exam sessions in `sessionStorage`.
- **A hardened localhost grading bridge** (`app/tools/vmbridge.py`). The browser cannot send arbitrary commands: it sends a question id, and the bridge resolves it to a pre-defined, server-side check before running it over SSH. Defence in depth: bound to `127.0.0.1`, random per-session token, `Origin` allowlist, request-size cap, and id validation. See [`docs/architecture/VM_GRADING_SPEC.md`](docs/architecture/VM_GRADING_SPEC.md).
- **A grader self-audit** (`app/tools/grader_audit.py`). It reverts the VMs to a clean snapshot and runs every grader: any task that scores above zero on a clean system is a false positive. This keeps the auto-grading honest.
- **Built by directing AI agents, then independently audited.** A builder agent wrote most of the code; changes were reviewed by a separate AI vendor before merge and verified against real behaviour — the same workflow described in my CV.

## Run the demo locally

```bash
cd app
python3 -m http.server 8765
# open http://localhost:8765/
```

Browse tasks under **Drill**, open one and toggle **Learn / Solve**, or run the timed **Exams** and self-assess.

## Optional: VM auto-grading

With a real RHEL 10 practice VM you can grade tasks over SSH from the browser. This needs local setup (SSH key, a config file, and the bridge running) and is described in [`app/SETUP-vmbridge.md`](app/SETUP-vmbridge.md). The grading command definitions for the real exam set are part of the excluded private data, so auto-grading is illustrated by the sample tasks and the architecture doc rather than wired up out of the box.

## Layout

```
app/
  index.html              SPA entry
  app.js                  the app: routing, screens, exam session, timer
  styles.css  en.css      base + English styles
  chat_en.js              optional AI tutor (talks to the local bridge)
  js/
    bridge.js             vmbridge HTTP client
    grader.js             score aggregation
    ui/progress.js        localStorage progress store
    data/                 ORIGINAL sample data (questions, exams, guides + EN overlays)
  tools/
    vmbridge.py           hardened localhost SSH bridge
    grader_audit.py       false-positive auditor
    *.sh                  VM snapshot/reset helpers
    vmbridge.config.example.json
  SETUP-vmbridge.md
docs/architecture/VM_GRADING_SPEC.md
```

## What is *not* here (and why)

- The ~190-question bank, the per-domain study guides, the command reference, and the wiki notes — all derived from third-party paid RHCSA materials. Excluded for copyright.
- The real `vmbridge.config.json` and any keys — local only, never committed.
- IP addresses in examples use the `192.0.2.0/24` documentation range, not real hosts.

## License

Code in this repository is released under the [MIT License](LICENSE). It is independent study software and is not affiliated with or endorsed by Red Hat.

The bundled fonts (Source Code Pro, Cantarell) are under the SIL Open Font License 1.1 — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
