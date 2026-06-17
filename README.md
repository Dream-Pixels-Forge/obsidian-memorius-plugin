# Memorius Vault — Obsidian Plugin

<p>
  <a href="https://github.com/Dream-Pixels-Forge/obsidian-memorius-plugin/releases"><img src="https://img.shields.io/github/v/release/Dream-Pixels-Forge/obsidian-memorius-plugin?logo=github" alt="Release"></a>
  <a href="https://obsidian.md"><img src="https://img.shields.io/badge/Obsidian-1.5.0+-purple?logo=obsidian" alt="Obsidian"></a>
  <img src="https://img.shields.io/github/languages/top/Dream-Pixels-Forge/obsidian-memorius-plugin" alt="Language">
  <img src="https://img.shields.io/github/license/Dream-Pixels-Forge/obsidian-memorius-plugin" alt="License">
  <img src="https://img.shields.io/github/last-commit/Dream-Pixels-Forge/obsidian-memorius-plugin?logo=github" alt="Last commit">
</p>

Connect your Obsidian vault to [Memorius](https://github.com/Dream-Pixels-Forge/memorius), the universal memory vault for AI agents. Semantic search, auto-sync, context injection, and MCP server management — all from within Obsidian.

## Features

| Feature | Description |
|---------|-------------|
| 🔍 **Semantic Search** | Vector-similarity search across all memories. Not keyword matching — understands meaning. |
| 🧠 **Context Injection** | Fetch related memories from Memorius and inject them into your current note. |
| 📊 **Dashboard** | Memory stats, shelf distribution, recent session diaries, quick actions. |
| 🔗 **Semantic Graph** | Visualize how the current note relates to other memories by vector similarity. |
| 🖥️ **MCP Console** | Test REST connectivity and see MCP tool docs. MCP server is managed externally. |
| 🔄 **Auto-Sync** | Automatically sync vault changes (create/modify/delete) to Memorius with debounce. |
| ✅ **Fact-Check** | Check statements against your memory vault for contradictions. |
| 📦 **Import/Export** | Import entire vault or single notes. Export Memorius context as Obsidian notes. |

## Requirements

- [Memorius](https://github.com/Dream-Pixels-Forge/memorius) v0.4.0+ with REST server running
- Obsidian v0.15.0+ (desktop)

## Installation

### From BRAT (coming soon)

1. Install the BRAT plugin in Obsidian
2. Add `Dream-Pixels-Forge/obsidian-memorius-plugin` to the BRAT plugin list
3. Enable "Memorius Vault" in Community Plugins

### Manual

1. Download the latest release from GitHub
2. Extract to `{vault}/.obsidian/plugins/memorius-vault/`
3. Enable the plugin in Settings → Community Plugins

### From source

```bash
git clone https://github.com/Dream-Pixels-Forge/obsidian-memorius-plugin.git
cd obsidian-memorius-plugin
npm install
npm run build
# Copy main.js, manifest.json, styles.css to your vault's plugins dir
```

## Setup

1. **Start the Memorius server:**
   ```bash
   memorius serve-rest
   ```
   Or start it from Obsidian using the MCP Console view.

2. **Enable the plugin** in Obsidian Settings → Community Plugins → Memorius Vault.

3. **Configure** the server URL (default: `http://127.0.0.1:8912`) in Settings → Memorius Vault Settings.

4. **Import your vault** via the dashboard or settings to seed Memorius with your notes.

## Usage

### Ribbon Icons

| Icon | Action |
|------|--------|
| 🔍 | Open Semantic Search |
| 🧠 | Open Context Injection |
| 📊 | Open Dashboard |
| 🔗 | Open Semantic Graph |
| 🖥️ | Open MCP Console |

### Commands

Press `Cmd+P` (Mac) / `Ctrl+P` (Windows) and type `Memorius` to access all commands:

- Open semantic search
- Open dashboard
- Open semantic graph
- Open MCP console
- Inject context for current note
- Import current note to Memorius
- Export context as new note
- Import entire vault
- Toggle auto-sync
- Consolidate memories

### Auto-Sync

When enabled, any note create/modify/delete event in Obsidian is automatically synced to Memorius with a configurable debounce delay (default: 2s). Configure in Settings.

## Development

```bash
# Install dependencies
pnpm install

# Type-check
npx tsc --noEmit

# Build for production
pnpm run build

# Watch mode (auto-rebuild on changes)
pnpm run dev
```

The build uses [esbuild](https://esbuild.github.io/) for fast bundling.

## Architecture

```
┌─────────────────────────────────┐
│      Obsidian (this plugin)     │
├─────────────────────────────────┤
│  Search  │  Context  │  Graph   │
│  Dashboard │  MCP Console       │
│  Auto-Sync │  Fact-Check        │
├─────────────────────────────────┤
│       HTTP REST (fetch)         │
├─────────────────────────────────┤
│     Memorius REST API (:8912)   │
│          (Python/FastAPI)       │
├─────────────────────────────────┤
│   ChromaDB  │  SQLite  │  MCP   │
└─────────────────────────────────┘
```

## Related

- [Memorius](https://github.com/Dream-Pixels-Forge/memorius) — The memory vault backend
- [Memorius Agent Skill](https://github.com/Dream-Pixels-Forge/memorius/tree/main/skills/memorius) — Auto-capture skill for AI agents
- [Dream Pixels Forge](https://github.com/Dream-Pixels-Forge) — More tools

## License

MIT
