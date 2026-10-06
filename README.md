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
[![Tests](https://img.shields.io/badge/tests-2038%20passing-brightgreen)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)]()

[![Stargazers over time](https://starchart.cc/Xinzhe99/lemma.svg?variant=light)](https://starchart.cc/Xinzhe99/lemma)

**[Features](#-features) · [Download](#-download) · [Quick Start](#-quick-start) · [Architecture](#%EF%B8%8F-architecture) · [Contributing](#-contributing)**

</div>

---

## 📸 Screenshots

| Writing & Live Preview | AI Session |
|:---:|:---:|
| ![Main layout](docs/layout-v6.png) | ![AI chat](docs/screenshots/tour-ai.png) |

## 🎯 Why Lemma

AI coding tools (Codex, Claude Code, Cursor) proved one thing: **an agent that acts beats a chatbot that talks**. Yet AI in paper-writing tools is still trapped in a chat box — it can't see your library, can't run your compiler, can't fix your citations, and never owns its changes.

Lemma is **Codex, rebuilt for LaTeX papers**:

| Codex (code) | Lemma (papers) |
|---|---|
| One repo, many sessions | One paper project, many AI sessions |
| Chat in the middle, code on the right | Editor + **live PDF** side by side, chat on the right |
| AI edits code → diff approval | AI edits the manuscript → diff approval, hunk-by-hunk |
| Built-in git, roll back anytime | Built-in git: every AI change auto-commits, one-click restore |
| Agent calls tools | Agent calls **18 paper-domain tools** (read PDFs, search the web, compile, cite…) |
| Idle-update, restart-safe | Same update UX; sessions & projects restored on restart |

No pomodoro timers, no dashboards — just writing, compiling, literature, and AI.

## ✨ Features

### 🖋 Writing environment

- **Editor + live PDF, side by side** — auto-recompile in 0.5 s; **the page you're reading never jumps** after recompile; after AI edits, the PDF scrolls to the changed spot (SyncTeX forward search)
- **Full-text search in PDF** — type to search, Enter/Shift+Enter cycles hits with page numbers
- **PDF annotations** — four semantic highlight colors; mark items pending/resolved; one-click "draft response letter" from unresolved comments
- **Engine matrix** — Tectonic / LuaLaTeX / XeLaTeX / pdfLaTeX / latexmk auto-detected; missing Tectonic auto-downloads (~30 MB, zero config) **and is pre-warmed on idle** — first compile is instant
- Compile errors → one-click **✦ AI fix**

### 🤖 AI (the point of Lemma)

The agent can call **18 tools** across up to 50 autonomous rounds:

| Category | Tools |
|---|---|
| Read papers | `paper.read` — full text of attached PDFs (paginated, truncation-guarded) |
| Find papers | `web.search_scholar` (arXiv + Crossref), `library.search_fulltext` (full-text of your library) |
| Edit | `tex.edit` / `tex.create_file` — always through diff approval |
| Cite | `citation.add` / `citation.validate` — hallucinated `\cite` keys are flagged automatically |
| Compile | `tex.compile` / `tex.last_errors` |
| Project | `project.context` / `read_file` / `find_in_files` / `list_files` |
| Memory | `memory.write` — the agent remembers your conventions across sessions |
| History | `git.log` / `git.show` — the agent can read its own change history |

**Input channels**: text, 🎤 voice (Whisper, fully local), 📎 images (multimodal), **any file** (drag in PDFs, Word, CSV — content is extracted and injected). **Output**: manuscript edits (approved), TikZ figures with compiled preview, layout review via page screenshots (✦ AI check this page), read-aloud proofreading (TTS).

### 📚 Library & review

- Zotero one-click sync (Better BibTeX endpoint), BibTeX/RIS/DOI/arXiv import
- Hybrid full-text retrieval (BM25 + vectors; attached PDFs indexed)
- Advisor round-trip: import Word/PDF review comments → resolve one by one → AI drafts point-by-point response letter

### 🔖 Version control (built-in git)

- Every approved AI change **auto-commits** (2 s debounce)
- History panel: line diff per commit, **red/blue changes.pdf** (local latexdiff equivalent) for advisor review, one-click restore
- GitHub sync: link your repo → Push / Pull with system-git credentials

### 🛠 And more

- 20 built-in templates (IEEE/ACM-style, Elsevier/math journals, arXiv, thesis, Chinese journal, Beamer ×2, A0 poster, cover letter…)
- Speech-to-text (Whisper, local, offline after first download)
- Codex-style auto-update: idle check → background download → confirm → restart restores everything
- 中文 / English UI switch

## 📥 Download

| Platform | Link |
|---|---|
| Windows | [Lemma_x64-setup.exe](https://github.com/Xinzhe99/lemma/releases/latest) |
| macOS (Apple Silicon) | [Lemma_aarch64.dmg](https://github.com/Xinzhe99/lemma/releases/latest) |
| macOS (Intel) | [Lemma_x64.dmg](https://github.com/Xinzhe99/lemma/releases/latest) |

All releases: [Releases](https://github.com/Xinzhe99/lemma/releases)

## 🚀 Quick Start

### From source

```bash
git clone https://github.com/Xinzhe99/lemma.git
cd lemma
npm install
npm run dev            # web preview (mock compile)
# or desktop:
cd apps/desktop && npm run desktop:dev
```

Prerequisites: Rust + Node 20+. **No LaTeX installation required** (Tectonic auto-downloads). Git optional (version panel degrades gracefully).

### Configure AI (30 seconds)

Settings → Model Service → pick a preset (DeepSeek / GLM / Kimi / Qwen / OpenAI / custom) → paste API key → Test connection. Without a key, everything runs in demo mode.

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

**Engineering**: 2,038 tests (178 files) · GitHub Actions CI (web + cargo-check) · zh/en UI · local-first (IndexedDB; API keys never leave the machine).

## 🗺 Roadmap

- [x] v1–v4: editor/compile/library/workflows foundation
- [x] v5: **Codex-style redesign** — sessions, live PDF, built-in git, feature purge
- [x] v6: images/voice/files in, visual review & TTS out, performance (-31% startup)
- [x] v7: multi-agent deep review — 22 confirmed bugs fixed
- [ ] Real-time collaboration (needs a signaling server)
- [ ] AI figure generation (photosci-style)

## 🤝 Contributing

Issues and PRs welcome. Before submitting: `npm run typecheck && npm test` (same gates as CI). See [CHANGELOG.md](CHANGELOG.md) for the full history.

## 📄 License

[MIT](LICENSE) © 2026 Lemma Contributors
