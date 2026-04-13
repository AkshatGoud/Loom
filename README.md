# Loom

A professional desktop chat app for local LLMs via Ollama and cloud LLMs via BYOK, with a full Model Context Protocol (MCP) client for weaving external tools into any conversation.

Loom runs on **macOS** and **Windows**. Local inference uses [Ollama](https://ollama.com) — users install Ollama separately, and Loom detects, connects to, and manages models through it. Cloud providers (OpenAI / Anthropic / Google) are supported via BYOK as optional add-ons.

**Status:** v0.1.0, under active development. Phases 1–4 of the 11-phase build plan are complete and working end-to-end on macOS. Windows parity and the MCP subsystem come in later phases. See the [roadmap](#roadmap) below.

---

## What's working today

- **Local chat with Ollama.** Gemma 4, Llama 3.x, Qwen 3, DeepSeek R1, and any other Ollama-installable model. Streaming responses with token counts.
- **First-run onboarding** that detects whether Ollama is installed / running / empty and walks the user through each state. Includes a "Start Ollama" button that spawns the daemon detached so it survives Loom quitting.
- **Model Library** with a curated catalog across multimodal / text / coding / reasoning / vision, live search, download progress bars, delete confirmation, and a "pull custom tag" fallback for anything not in the curated list.
- **In-chat Model Picker** dropdown in the chat header. Switch models mid-conversation with full context preserved. Each row has two actions: plain switch (leaves previous model warm) and switch+unload (frees RAM immediately). "Loaded" pills next to any model currently resident in Ollama's memory.
- **Unload button** in the chat header for manually freeing RAM when the current model isn't needed.
- **Multi-conversation chat** with SQLite-persisted history. Conversations survive app restarts with full message history, system prompts, and token counts.
- **Streaming chat UI** with markdown rendering, code block highlighting, stop-mid-stream, and auto-scroll.
- **Secure Electron foundation**: context isolation, sandboxed renderer, no raw `ipcRenderer` exposed, CommonJS preload, typed IPC bridge.

## Not yet implemented

| Phase | Scope |
|---|---|
| 5 | MCP client foundation (registry, stdio transport, listTools) |
| 6 | Tool-call loop in providers (Ollama inherits tool calling for free via OpenAI-compatible endpoint) |
| 7 | MCP UI + bundled server presets (filesystem, memory, git, GitHub) |
| 8 | BYO MCP server flow (Streamable HTTP + Claude Desktop config import) |
| 9 | Cloud BYOK add-ons (OpenAI / Anthropic / Google via OS keychain) |
| 10 | Polish — system prompts, dark mode toggle, shortcuts, audit log |
| 11 | Windows parity pass |

---

## Requirements

- **macOS** (Apple Silicon or Intel) or **Windows** (x64)
- **Node.js 20+** and **npm 10+**
- **[Ollama](https://ollama.com/download)** installed (the app will guide first-time users through this)

For development builds on a fresh machine, expect ~1–3 GB of `node_modules` and a first `npm install` that runs `@electron/rebuild` for `better-sqlite3`.

## Getting started

```bash
git clone https://github.com/AkshatGoud/Loom.git
cd Loom
npm install          # also rebuilds better-sqlite3 against Electron's Node ABI
npm run dev          # starts electron-vite with hot reload for main, preload, and renderer
```

The first time you launch, the Ollama Onboarding screen walks you through install → start → pull a model (Gemma 4 E4B is the recommended first pull).

### Pulling a first model

From inside the app: click **Models** in the sidebar → search for `gemma` → click **Pull** on the E4B variant. Or do it from the terminal:

```bash
ollama pull gemma4:e4b
```

Gemma 4 E4B is the sweet spot for most 16 GB machines. On smaller machines, use `gemma4:e2b` instead. 26B and 31B variants require 32 GB+ and 48 GB+ of RAM respectively.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Starts electron-vite in dev mode with hot reload. DevTools auto-open. Renderer console forwards to the main-process log. |
| `npm run build` | Compiles main, preload, and renderer for production. |
| `npm run typecheck` | Runs `tsc --noEmit` across both the Node and web TypeScript projects. |
| `npm run typecheck:node` | Typechecks the main + preload + shared code. |
| `npm run typecheck:web` | Typechecks the renderer + shared code. |
| `npm run dist` | Builds and packages a macOS arm64 release via `electron-builder`. |

## Architecture

```
┌──────────────────┐  typed IPC  ┌────────────────────────────┐   HTTP    ┌─────────────────┐
│  React Renderer  │ ──────────▶ │      Electron Main         │ ────────▶ │  Ollama daemon  │
│ (Tailwind / dark)│ ◀────────── │                            │ ◀──────── │ localhost:11434 │
└──────────────────┘   stream    │  Provider registry         │           └─────────────────┘
                                 │    ├─ Ollama               │
                                 │    ├─ OpenAI (future BYOK) │   HTTPS    OpenAI / Anthropic /
                                 │    ├─ Anthropic (future)   │ ────────▶  Google (future)
                                 │    └─ Google   (future)    │
                                 │                            │
                                 │  MCP client (future)       │   stdio / Streamable HTTP
                                 │                            │ ─────────▶ any MCP server
                                 │                            │
                                 │  SQLite (loom.db)          │
                                 │  OS Keychain (future keys) │
                                 └────────────────────────────┘
```

The **Ollama provider** is a ~80-line adapter that instantiates the `openai` SDK with `baseURL: http://localhost:11434/v1` and delegates all streaming to the same code path as a real OpenAI provider would. Zero duplicated chat logic.

Loom does **not** own Ollama's process lifecycle — Ollama runs as a user-installed background service, and Loom only probes `/api/version` and `/api/ps`. Killing Loom leaves Ollama running; killing Ollama shows a non-modal toast and disables the composer until it comes back.

### Project layout

```
src/
├── main/                        # Electron main process (Node, ESM)
│   ├── index.ts                 # app lifecycle, BrowserWindow
│   ├── ipc/                     # typed IPC handlers
│   ├── inference/               # Provider interface + adapters
│   ├── ollama/                  # daemon detection, /api/* wrapper, curated catalog
│   └── db/                      # SQLite schema + queries via better-sqlite3
├── preload/                     # contextBridge → window.api  (CommonJS .cjs)
├── renderer/                    # React app (Vite)
│   └── src/
│       ├── App.tsx              # top-level layout
│       ├── components/          # Sidebar, ChatView, Composer, Model*, Ollama*
│       ├── stores/              # Zustand: conversations, models, ollama, settings
│       ├── hooks/               # useStreamingChat
│       └── lib/                 # cn() helper, formatters
└── shared/
    └── types.ts                 # single source of truth for IPC contracts
```

## Tech stack

- **Electron 33** + **electron-vite 2** + **Vite 5**
- **React 19** + **Tailwind CSS 3** + **Radix UI** primitives
- **TypeScript** strict mode across main, preload, and renderer with typed IPC
- **better-sqlite3** for synchronous local persistence
- **Zustand** for renderer state
- **openai** SDK used for both real OpenAI *and* Ollama (via `baseURL`)
- **@anthropic-ai/sdk** and **@google/generative-ai** (wired in Phase 9)
- **@modelcontextprotocol/sdk** (wired starting Phase 5)
- **keytar** for OS keychain secret storage (wired in Phase 9)

## Roadmap

The complete phased build plan lives in a private plan file (`~/.claude/plans/splendid-tumbling-wozniak.md`). Short version:

- ✅ **Phase 1** — Scaffold (Electron + React + TS + Tailwind)
- ✅ **Phase 2** — Provider interface, OpenAI adapter as validator, SQLite persistence, chat UI
- ✅ **Phase 3** — Ollama provider + first-run onboarding
- ✅ **Phase 4** — Model library + picker + in-chat model switching with context preservation
- ⏳ **Phase 5** — MCP client foundation
- ⏳ **Phase 6** — Tool-call loop in providers
- ⏳ **Phase 7** — MCP UI + bundled server presets
- ⏳ **Phase 8** — BYO MCP server flow (Streamable HTTP + clipboard import)
- ⏳ **Phase 9** — Cloud BYOK add-ons (OpenAI / Anthropic / Google)
- ⏳ **Phase 10** — Polish (system prompts, dark mode toggle, shortcuts, audit log)
- ⏳ **Phase 11** — Windows parity pass

## License

Proprietary. All rights reserved. License terms TBD as the project approaches v1.0 and commercial release.
