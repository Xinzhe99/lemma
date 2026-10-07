<div align="center">

<img src="brand/png/icon-256.png" width="120" alt="Lemma logo" />

# Lemma

**The Codex for LaTeX — an AI-native paper writing workspace**

**[English](README.md)** · [简体中文](README.zh-CN.md)

*One project, many AI sessions, live PDF preview — write papers the way you write code with Codex.*

[![CI](https://github.com/Xinzhe99/lemma/actions/workflows/ci.yml/badge.svg)](https://github.com/Xinzhe99/lemma/actions/workflows/ci.yml)
[![Release](https://github.com/Xinzhe99/lemma/actions/workflows/release.yml/badge.svg)](https://github.com/Xinzhe99/lemma/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/Xinzhe99/lemma?color=orange)](https://github.com/Xinzhe99/lemma/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey)]()
[![Tauri](https://img.shields.io/badge/Tauri-2-orange)](https://v2.tauri.app)
[![Tests](https://img.shields.io/badge/tests-2354%20passing-brightgreen)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)]()

[![Stargazers over time](https://starchart.cc/Xinzhe99/lemma.svg?variant=light)](https://starchart.cc/Xinzhe99/lemma)

**[Features](#-features) · [Download](#-download) · [Quick Start](#-quick-start) · [Architecture](#%EF%B8%8F-architecture) · [Documentation](#-documentation) · [Contributing](#-contributing)**

</div>

---

## 📸 Screenshots

| Writing & live preview | AI session |
|:---:|:---:|
| ![Main layout](docs/screenshots/tour-main.png) | ![AI chat](docs/screenshots/tour-ai.png) |

## 🎯 Why Lemma

AI coding tools (Codex, Claude Code, Cursor) proved one thing: **an agent that acts beats a chatbot that talks**. Yet AI in paper-writing tools is still trapped in a chat box — it can't see your library, can't run your compiler, can't fix your citations, and never owns its changes.

Lemma is **Codex, rebuilt for LaTeX papers**:

| Codex (code) | Lemma (papers) |
|---|---|
| One repo, many sessions | One paper project, many AI sessions |
| Chat in the middle, code on the right | Editor + **live PDF** side by side, chat on the right |
| AI edits code → diff approval | AI edits the manuscript → diff approval, hunk by hunk |
| Built-in git, roll back anytime | Built-in git: every AI change auto-commits, one-click restore |
| Agent calls tools | Agent calls **19 paper-domain tools** (read PDFs, search the web, compile, cite…) |
| Idle update, restart-safe | Same update UX; sessions & projects restored on restart |

No pomodoro timers, no dashboards — just writing, compiling, literature, and AI.

## ✨ Features

### 🖋 Writing environment

- **Editor + live PDF, side by side** — auto-recompile in 0.5 s; the page you are reading never jumps after a recompile; after AI edits, the PDF scrolls to the changed spot (SyncTeX forward search)
- **PDF full-text search** — type to search; Enter / Shift+Enter cycle through hits with page numbers
- **PDF annotations** — four semantic highlight colors; mark items pending / resolved; one-click "draft response letter" from unresolved comments
- **Engine matrix** — Tectonic / LuaLaTeX / XeLaTeX / pdfLaTeX / latexmk, auto-detected; a missing Tectonic is downloaded automatically (~30 MB, zero config) and pre-warmed on idle, so the first compile is instant
- Compile errors → one-click **✦ AI fix**
- **Switch models mid-conversation** — a compact picker in the chat box (Codex-style); applies from the next turn
- **Permission modes** — you decide what the AI may do: **View only** / **Workspace edits** (diff-approved) / **Full access**; tool activity renders as compact collapsible cards, never raw logs

### 🤖 AI

The agent can call **19 tools** across up to 50 autonomous rounds:

| Category | Tools |
|---|---|
| Read papers | `paper.read` — full text of attached PDFs (paginated, truncation-guarded) |
| Find papers | `web.search_scholar` (arXiv + Crossref), `library.search_fulltext` (full-text of your library) |
| Edit | `tex.edit` / `tex.create_file` — always through diff approval |
| Cite | `citation.add` / `citation.validate` — hallucinated `\cite` keys are flagged automatically |
| Compile | `tex.compile` / `tex.last_errors` |
| Project | `project.context` / `project.read_file` / `project.find_in_files` / `project.list_files` |
| Memory & history | `memory.write` — the agent remembers your conventions across sessions; `git.log` / `git.show` — it can read its own change history |
| Submit & safety | `submission.checklist` (journal requirements), `snapshot.create` (snapshot before writes), `user.ask` (one blocking question when only a human can decide) |

> Three further tools exist in the registry but are not wired up in this build (`library.search`, `paper.citations`, `figure.render`); calling one returns an explicit "not connected" notice.

**Input**: text, 🎤 voice (Whisper, fully local), 📎 images (multimodal), and **any file** — drag in PDFs, Word, or CSV and the content is extracted and injected. **Output**: manuscript edits (diff-approved), TikZ figures with compiled preview, layout review via page screenshots (✦ AI check this page), and read-aloud proofreading (TTS).

### 📚 Library & review

- Zotero one-click sync (Better BibTeX endpoint); BibTeX / RIS / DOI / arXiv import
- Hybrid full-text retrieval (BM25 + vectors; attached PDFs are indexed)
- Advisor round-trip: import Word / PDF review comments → resolve them one by one → AI drafts a point-by-point response letter

### 🔖 Version control (built-in git)

- Every approved AI change **auto-commits** (2 s debounce)
- History panel: line diff per commit, **red/blue changes.pdf** (a local latexdiff equivalent) for advisor review, one-click restore
- GitHub sync: link your repo → Push / Pull with system-git credentials

### 🛠 More

- 20 built-in templates (IEEE / ACM-style, Elsevier / math journals, arXiv, thesis, Chinese journal, Beamer ×2, A0 poster, cover letter…)
- Speech-to-text (Whisper, local, offline after the first download)
- Codex-style auto-update: idle check → background download → confirm → restart restores everything
- 中文 / English UI

## 📥 Download

| Platform | Package |
|---|---|
| Windows 10 / 11 | `.exe` installer — [latest release](https://github.com/Xinzhe99/lemma/releases/latest) |
| macOS (Apple Silicon) | `.dmg` — [latest release](https://github.com/Xinzhe99/lemma/releases/latest) |
| macOS (Intel) | `.dmg` — [latest release](https://github.com/Xinzhe99/lemma/releases/latest) |

All versions: [Releases](https://github.com/Xinzhe99/lemma/releases). Installed copies update through the in-app auto-updater.

## 🚀 Quick Start

### Run from source

```bash
git clone https://github.com/Xinzhe99/lemma.git
cd lemma
npm install
npm run dev              # web preview (mock compile)
cd apps/desktop
npm run desktop:dev      # desktop app (Tauri)
```

**Requirements**

- Rust (via [rustup](https://rustup.rs)) and Node.js 20+
- No LaTeX installation needed — Tectonic downloads automatically
- Git is optional; the version panel degrades gracefully without it

### Configure AI (30 seconds)

1. Open **Settings → Model Service**
2. Pick a preset (DeepSeek / GLM / Kimi / Qwen / OpenAI / custom) and paste your API key
3. **Test connection**, then save — without a key, everything runs in demo mode

### Build installers

Windows: [TAURI.md](TAURI.md) · macOS: [docs/BUILD_MAC.md](docs/BUILD_MAC.md)

## 🏗️ Architecture

```
apps/desktop            App shell (Tauri 2 + React; Rust bridge: virtual FS / secrets / process / updater)
packages/shared         Domain types
packages/editor         LaTeX editor (CodeMirror 6)
packages/compile        Compilation (engine matrix · log parsing · real SyncTeX · templates)
packages/library        Library + PDF reader
packages/agent-hub      Agent core (streaming · tools · blocking approvals · workflows)
packages/knowledge      RAG · Context Pack · citation guardrails
```

**Engineering**: 2,350 tests (205 files) · GitHub Actions CI (web + cargo-check) · zh/en UI · local-first (IndexedDB; API keys never leave the machine).

## 📚 Documentation

- [CHANGELOG.md](CHANGELOG.md) — release history
- [DESIGN.md](DESIGN.md) — product & system design
- [TAURI.md](TAURI.md) — desktop shell, bridge commands, Windows build
- [docs/BUILD_MAC.md](docs/BUILD_MAC.md) — macOS build & signing
- [docs/agent-foundation-alignment.md](docs/agent-foundation-alignment.md) — agent capability alignment matrix

## 🤝 Contributing

Issues and PRs are welcome. Before submitting, run `npm run typecheck && npm test` — the same gates as CI.

## 📄 License

[MIT](LICENSE) © 2026 Lemma Contributors
