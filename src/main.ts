import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  ItemView,
  WorkspaceLeaf,
  Notice,
  Modal,
  TFile,
  TAbstractFile,
  normalizePath,
} from 'obsidian';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

interface MemoriusSettings {
  serverUrl: string;
  defaultVault: string;
  autoSync: boolean;
  autoSyncDelay: number;
  syncOnStartup: boolean;
  showStatusBar: boolean;
  maxSearchResults: number;
  mcpServerPath: string;
  mcpAutoStart: boolean;
}

const DEFAULT_SETTINGS: MemoriusSettings = {
  serverUrl: 'http://127.0.0.1:8912',
  defaultVault: 'main',
  autoSync: false,
  autoSyncDelay: 2000,
  syncOnStartup: false,
  showStatusBar: true,
  maxSearchResults: 20,
  mcpServerPath: 'memorius',
  mcpAutoStart: false,
};

interface MemoriusMemory {
  id: string;
  content: string;
  vault: string;
  shelf: string;
  folder: string;
  note: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  score?: number;
}

interface SearchResult {
  query: string;
  count: number;
  results: MemoriusMemory[];
}

interface VaultHierarchy {
  vaults: { name: string; shelf_count: number; memory_count: number }[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const VIEW_TYPE_MEMORIUS_SEARCH = 'memorius-search-view';
const VIEW_TYPE_MEMORIUS_CONTEXT = 'memorius-context-view';
const VIEW_TYPE_MEMORIUS_DASHBOARD = 'memorius-dashboard-view';
const VIEW_TYPE_MEMORIUS_GRAPH = 'memorius-graph-view';
const VIEW_TYPE_MEMORIUS_MCP = 'memorius-mcp-view';

// ═══════════════════════════════════════════════════════════════════════════════
// Plugin
// ═══════════════════════════════════════════════════════════════════════════════

export default class MemoriusVaultPlugin extends Plugin {
  declare settings: MemoriusSettings;
  private statusBarItem: HTMLElement | null = null;
  private syncTimers: Map<string, NodeJS.Timeout> = new Map();
  private mcpProcess: any = null;

  async onload() {
    await this.loadSettings();

    // ── Register all views ──
    this.registerView(VIEW_TYPE_MEMORIUS_SEARCH,     (leaf) => new SearchView(leaf, this));
    this.registerView(VIEW_TYPE_MEMORIUS_CONTEXT,     (leaf) => new ContextView(leaf, this));
    this.registerView(VIEW_TYPE_MEMORIUS_DASHBOARD,   (leaf) => new DashboardView(leaf, this));
    this.registerView(VIEW_TYPE_MEMORIUS_GRAPH,       (leaf) => new GraphView(leaf, this));
    this.registerView(VIEW_TYPE_MEMORIUS_MCP,         (leaf) => new McpView(leaf, this));

    // ── Ribbon icons ──
    this.addRibbonIcon('search', 'Memorius Semantic Search', () => this.activateView(VIEW_TYPE_MEMORIUS_SEARCH));
    this.addRibbonIcon('brain', 'Memorius Context',          () => this.openContextModal());
    this.addRibbonIcon('bar-chart', 'Memorius Dashboard',    () => this.activateView(VIEW_TYPE_MEMORIUS_DASHBOARD));
    this.addRibbonIcon('git-fork', 'Memorius Semantic Graph',() => this.activateView(VIEW_TYPE_MEMORIUS_GRAPH));
    this.addRibbonIcon('terminal', 'Memorius MCP Console',   () => this.activateView(VIEW_TYPE_MEMORIUS_MCP));

    // ── Commands ──
    this.addCommand({ id: 'memorius-search',         name: 'Open semantic search',          callback: () => this.activateView(VIEW_TYPE_MEMORIUS_SEARCH) });
    this.addCommand({ id: 'memorius-dashboard',      name: 'Open dashboard',                callback: () => this.activateView(VIEW_TYPE_MEMORIUS_DASHBOARD) });
    this.addCommand({ id: 'memorius-graph',          name: 'Open semantic graph',           callback: () => this.activateView(VIEW_TYPE_MEMORIUS_GRAPH) });
    this.addCommand({ id: 'memorius-mcp',            name: 'Open MCP console',              callback: () => this.activateView(VIEW_TYPE_MEMORIUS_MCP) });
    this.addCommand({ id: 'memorius-inject-context', name: 'Inject context for current note', callback: () => this.openContextModal() });
    this.addCommand({ id: 'memorius-import-note',    name: 'Import current note to Memorius', callback: () => this.importActiveNote() });
    this.addCommand({ id: 'memorius-export-context', name: 'Export context as new note',    callback: () => this.exportContextToNote() });
    this.addCommand({ id: 'memorius-import-vault',   name: 'Import entire vault',           callback: () => this.importEntireVault() });
    this.addCommand({ id: 'memorius-toggle-sync',    name: 'Toggle auto-sync',              callback: () => this.toggleAutoSync() });
    this.addCommand({ id: 'memorius-consolidate',    name: 'Consolidate memories',          callback: () => this.runConsolidate() });

    // ── Auto-sync event listeners ──
    this.registerEvent(this.app.vault.on('create', (file: TAbstractFile) => { if (file instanceof TFile) this.onFileChanged(file, 'create'); }));
    this.registerEvent(this.app.vault.on('modify', (file: TAbstractFile) => { if (file instanceof TFile) this.onFileChanged(file, 'modify'); }));
    this.registerEvent(this.app.vault.on('delete', (file: TAbstractFile) => { if (file instanceof TFile) this.onFileDeleted(file); }));

    // ── Settings ──
    this.addSettingTab(new MemoriusSettingTab(this.app, this));

    // ── Status bar ──
    if (this.settings.showStatusBar) {
      this.statusBarItem = this.addStatusBarItem();
      this.updateStatusBar();
    }

    // ── Auto-open search on layout ready ──
    this.app.workspace.onLayoutReady(() => {
      if (this.app.workspace.getLeavesOfType(VIEW_TYPE_MEMORIUS_SEARCH).length === 0) {
        this.activateView(VIEW_TYPE_MEMORIUS_SEARCH);
      }
      if (this.settings.syncOnStartup) {
        this.importEntireVault();
      }
    });
  }

  onunload() {
    for (const type of [VIEW_TYPE_MEMORIUS_SEARCH, VIEW_TYPE_MEMORIUS_CONTEXT,
                        VIEW_TYPE_MEMORIUS_DASHBOARD, VIEW_TYPE_MEMORIUS_GRAPH,
                        VIEW_TYPE_MEMORIUS_MCP]) {
      this.app.workspace.detachLeavesOfType(type);
    }
    // Kill MCP process if running
    if (this.mcpProcess) {
      try { this.mcpProcess.kill(); } catch { /* ignore */ }
      this.mcpProcess = null;
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.updateStatusBar();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Auto-Sync
  // ═══════════════════════════════════════════════════════════════════════════

  private onFileChanged(file: TFile, event: 'create' | 'modify') {
    if (!this.settings.autoSync) return;
    if (file.extension !== 'md') return;

    // Debounce by file path
    const key = file.path;
    const existing = this.syncTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      this.syncTimers.delete(key);
      try {
        const content = await this.app.vault.read(file);
        const folder = file.parent?.name || 'root';
        await this.storeMemory(content, folder, file.basename, {
          path: file.path,
          event,
          synced_from: 'obsidian-auto',
        });
      } catch (e) {
        // Silently fail - might be disconnected
      }
    }, this.settings.autoSyncDelay);

    this.syncTimers.set(key, timer);
  }

  private onFileDeleted(file: TFile) {
    if (!this.settings.autoSync) return;
    // Clean up timer
    const key = file.path;
    const existing = this.syncTimers.get(key);
    if (existing) clearTimeout(existing);
    this.syncTimers.delete(key);
  }

  private toggleAutoSync() {
    this.settings.autoSync = !this.settings.autoSync;
    this.saveSettings();
    new Notice(`Auto-sync ${this.settings.autoSync ? 'enabled' : 'disabled'}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MCP Server Management
  // ═══════════════════════════════════════════════════════════════════════════

  async startMcpServer(): Promise<boolean> {
    if (this.mcpProcess) {
      new Notice('MCP server already running');
      return true;
    }

    try {
      const { spawn } = await import('child_process');
      this.mcpProcess = spawn(this.settings.mcpServerPath, ['mcp'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      this.mcpProcess.on('error', (err: any) => {
        new Notice(`MCP server error: ${err.message}`);
        this.mcpProcess = null;
      });

      this.mcpProcess.on('exit', (code: number) => {
        if (code !== 0 && code !== null) {
          new Notice(`MCP server exited with code ${code}`);
        }
        this.mcpProcess = null;
      });

      // Notify MCP views
      this.app.workspace.getLeavesOfType(VIEW_TYPE_MEMORIUS_MCP).forEach(leaf => {
        if (leaf.view instanceof McpView) leaf.view.onMcpStatusChange(true);
      });

      new Notice('MCP server started');
      return true;
    } catch (e) {
      new Notice(`Failed to start MCP: ${e.message}`);
      return false;
    }
  }

  stopMcpServer() {
    if (!this.mcpProcess) {
      new Notice('MCP server not running');
      return;
    }
    try { this.mcpProcess.kill(); } catch { /* ignore */ }
    this.mcpProcess = null;

    this.app.workspace.getLeavesOfType(VIEW_TYPE_MEMORIUS_MCP).forEach(leaf => {
      if (leaf.view instanceof McpView) leaf.view.onMcpStatusChange(false);
    });
    new Notice('MCP server stopped');
  }

  isMcpRunning(): boolean {
    return this.mcpProcess !== null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // API calls
  // ═══════════════════════════════════════════════════════════════════════════

  private async apiRequest<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const url = `${this.settings.serverUrl}${path}`;
    const options: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(url, options);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Memorius API error (${res.status}): ${text}`);
    }
    return res.json() as Promise<T>;
  }

  async search(query: string, limit?: number): Promise<SearchResult> {
    return this.apiRequest<SearchResult>('POST', '/search', {
      query, vault: this.settings.defaultVault, limit: limit || this.settings.maxSearchResults,
    });
  }

  async getContext(query: string, maxItems?: number): Promise<string> {
    const r = await this.apiRequest<{ context: string }>('POST', '/context', {
      query, vault: this.settings.defaultVault, max_items: maxItems || 5,
    });
    return r.context;
  }

  async storeMemory(content: string, folder: string, note: string, metadata?: Record<string, unknown>): Promise<MemoriusMemory> {
    return this.apiRequest<MemoriusMemory>('POST', '/store', {
      content, vault: this.settings.defaultVault, shelf: 'obsidian', folder, note, metadata,
    });
  }

  async getStatus(): Promise<Record<string, unknown>> {
    return this.apiRequest<Record<string, unknown>>('GET', '/status');
  }

  async getStats(): Promise<Record<string, unknown>> {
    return this.apiRequest<Record<string, unknown>>('GET', '/stats');
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.apiRequest<{ status: string }>('GET', '/health');
      return true;
    } catch { return false; }
  }

  async getHierarchy(vault?: string): Promise<VaultHierarchy> {
    const v = vault || this.settings.defaultVault;
    return this.apiRequest<VaultHierarchy>('GET', `/vault?vault=${encodeURIComponent(v)}`);
  }

  async getDiaries(limit: number = 10): Promise<any[]> {
    const v = this.settings.defaultVault;
    return this.apiRequest<any[]>('GET', `/diaries?vault=${encodeURIComponent(v)}&limit=${limit}`);
  }

  async mineText(text: string): Promise<{ stored: number; memory_ids: string[] }> {
    return this.apiRequest<{ stored: number; memory_ids: string[] }>('POST', '/mine', {
      text, vault: this.settings.defaultVault,
    });
  }

  async factcheck(statement: string): Promise<Record<string, unknown>> {
    return this.apiRequest<Record<string, unknown>>('POST', '/factcheck', {
      statement, vault: this.settings.defaultVault,
    });
  }

  async consolidate(dryRun: boolean = false): Promise<Record<string, unknown>> {
    return this.apiRequest<Record<string, unknown>>('POST', '/consolidate', {
      vault: this.settings.defaultVault, confirm: !dryRun, dry_run: dryRun,
    });
  }

  async extractMemories(text: string): Promise<Record<string, unknown>> {
    return this.apiRequest<Record<string, unknown>>('POST', '/extract', {
      text, vault: this.settings.defaultVault,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Plugin actions
  // ═══════════════════════════════════════════════════════════════════════════

  async activateView(viewType: string) {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(viewType);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: viewType, active: true });
      workspace.revealLeaf(leaf);
    }
  }

  async openContextModal() {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      const content = await this.app.vault.read(activeFile);
      new ContextInjectModal(this.app, this, content).open();
    } else {
      new Notice('Open a note first to inject context');
    }
  }

  async importActiveNote() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) { new Notice('No active note'); return; }
    const content = await this.app.vault.read(activeFile);
    const folder = activeFile.parent?.name || 'root';
    try {
      await this.storeMemory(content, folder, activeFile.basename, { path: activeFile.path, imported_from: 'obsidian' });
      new Notice(`Imported "${activeFile.basename}"`);
    } catch (e) { new Notice(`Failed: ${e.message}`); }
  }

  async importEntireVault() {
    const files = this.app.vault.getMarkdownFiles();
    new Notice(`Importing ${files.length} notes...`);
    let count = 0, failed = 0;
    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        const folder = file.parent?.name || 'root';
        await this.storeMemory(content, folder, file.basename, { path: file.path, imported_from: 'obsidian' });
        count++;
      } catch { failed++; }
      if (count % 50 === 0) new Notice(`Imported ${count}/${files.length}...`);
    }
    new Notice(`Complete: ${count} imported, ${failed} failed`);
    this.updateStatusBar();
  }

  async exportContextToNote() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) { new Notice('Open a note first'); return; }
    const title = activeFile.basename;
    try {
      const context = await this.getContext(title);
      const fileName = `memorius-context-${title}.md`;
      const path = normalizePath(fileName);
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, context);
        new Notice(`Updated ${fileName}`);
      } else {
        await this.app.vault.create(path, context);
        new Notice(`Created ${fileName}`);
      }
    } catch (e) { new Notice(`Failed: ${e.message}`); }
  }

  async runConsolidate() {
    try {
      const result = await this.consolidate(false);
      new Notice(`Consolidated: ${result.memories_merged as number} merged, ${result.memories_archived as number} archived`);
    } catch (e) { new Notice(`Failed: ${e.message}`); }
  }

  async updateStatusBar() {
    if (!this.statusBarItem) return;
    try {
      const stats = await this.getStats() as any;
      const total = stats?.memory_tracking?.total || 0;
      this.statusBarItem.setText(`Memorius: ${total} memories`);
    } catch {
      this.statusBarItem.setText('Memorius: disconnected');
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helper — builds a card UI element for a memory result
// ═══════════════════════════════════════════════════════════════════════════════

function buildMemoryCard(container: HTMLElement, mem: MemoriusMemory, app: App, showPath: boolean = true) {
  const card = container.createEl('div', { cls: 'memorius-result-card' });

  if (mem.score !== undefined) {
    card.createEl('span', { cls: 'memorius-score', text: `${Math.round(mem.score * 100)}%` });
  }

  if (showPath) {
    const title = card.createEl('div', { cls: 'memorius-result-title' });
    title.setText(`${mem.shelf} › ${mem.folder} › ${mem.note}`);
  }

  const preview = card.createEl('div', { cls: 'memorius-result-preview' });
  const c = mem.content || '';
  preview.setText(c.length > 300 ? c.substring(0, 300) + '...' : c);

  const actions = card.createEl('div', { cls: 'memorius-result-actions' });

  // Open note button
  const notePath = mem.metadata?.path as string | undefined;
  if (notePath) {
    const openBtn = actions.createEl('button', { text: 'Open note', cls: 'memorius-action-btn' });
    openBtn.addEventListener('click', () => app.workspace.openLinkText(notePath, '', false));
  }

  // Copy button
  const copyBtn = actions.createEl('button', { text: 'Copy', cls: 'memorius-action-btn' });
  copyBtn.addEventListener('click', () => { navigator.clipboard.writeText(mem.content); new Notice('Copied'); });

  return card;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Search View
// ═══════════════════════════════════════════════════════════════════════════════

class SearchView extends ItemView {
  plugin: MemoriusVaultPlugin;
  private searchInput!: HTMLInputElement;
  private resultsContainer!: HTMLElement;
  private statusEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: MemoriusVaultPlugin) { super(leaf); this.plugin = plugin; }
  getViewType(): string { return VIEW_TYPE_MEMORIUS_SEARCH; }
  getDisplayText(): string { return 'Memorius Semantic Search'; }
  getIcon(): string { return 'search'; }

  async onOpen() {
    const c = this.containerEl.children[1] as HTMLElement;
    c.empty(); c.addClass('memorius-container');

    c.createEl('div', { cls: 'memorius-header' }).createEl('h3', { text: '🔍 Semantic Search' });

    const row = c.createEl('div', { cls: 'memorius-search-row' });
    this.searchInput = row.createEl('input', { type: 'text', placeholder: 'Search memories semantically...', cls: 'memorius-search-input' });
    row.createEl('button', { text: 'Search', cls: 'memorius-search-btn' }).addEventListener('click', () => this.doSearch());
    this.searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.doSearch(); });

    this.statusEl = c.createEl('div', { cls: 'memorius-status', text: 'Ready' });
    this.resultsContainer = c.createEl('div', { cls: 'memorius-results' });
    this.checkConnection();
  }

  async checkConnection() {
    const ok = await this.plugin.checkHealth();
    this.statusEl.setText(ok ? '✅ Connected' : '❌ Server not running');
    this.statusEl.className = `memorius-status ${ok ? 'memorius-status-ok' : 'memorius-status-err'}`;
  }

  async doSearch() {
    const query = this.searchInput.value.trim();
    if (!query) { new Notice('Enter a query'); return; }
    this.resultsContainer.empty();
    this.statusEl.setText('Searching...');

    try {
      const results = await this.plugin.search(query);
      this.statusEl.setText(`Found ${results.count} results`);
      if (results.count === 0) {
        this.resultsContainer.createEl('div', { cls: 'memorius-no-results', text: 'No matches found.' });
        return;
      }
      for (const mem of results.results) buildMemoryCard(this.resultsContainer, mem, this.app);
    } catch (e: any) {
      this.resultsContainer.empty();
      this.statusEl.className = 'memorius-status memorius-status-err';
      this.statusEl.setText(`Error: ${e.message}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Context View
// ═══════════════════════════════════════════════════════════════════════════════

class ContextView extends ItemView {
  plugin: MemoriusVaultPlugin;
  private ctxContainer!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: MemoriusVaultPlugin) { super(leaf); this.plugin = plugin; }
  getViewType(): string { return VIEW_TYPE_MEMORIUS_CONTEXT; }
  getDisplayText(): string { return 'Memorius Context'; }
  getIcon(): string { return 'brain'; }

  async onOpen() {
    const c = (this.containerEl.children[1] as HTMLElement);
    c.empty(); c.addClass('memorius-container');
    c.createEl('div', { cls: 'memorius-header' }).createEl('h3', { text: '🧠 Related Context' });
    this.ctxContainer = c.createEl('div', { cls: 'memorius-context-body' });
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refresh()));
    await this.refresh();
  }

  async refresh() {
    const file = this.app.workspace.getActiveFile();
    this.ctxContainer.empty();
    if (!file) {
      this.ctxContainer.createEl('p', { cls: 'memorius-hint', text: 'Open a note to see related context.' });
      return;
    }
    this.ctxContainer.createEl('p', { cls: 'memorius-loading', text: 'Loading...' });

    try {
      const results = await this.plugin.search(file.basename);
      this.ctxContainer.empty();
      if (results.count === 0) {
        this.ctxContainer.createEl('p', { cls: 'memorius-hint', text: 'No related memories found.' });
        return;
      }

      const hdr = this.ctxContainer.createEl('div', { cls: 'memorius-context-header' });
      hdr.createEl('span', { text: `${results.count} related memories` });

      const injectBtn = hdr.createEl('button', { text: 'Inject into note', cls: 'memorius-action-btn' });
      injectBtn.addEventListener('click', async () => {
        const ctx = await this.plugin.getContext(file.basename);
        const editor = this.app.workspace.activeEditor?.editor;
        if (editor) editor.replaceSelection(`\n\n<!-- context -->\n${ctx}\n<!-- /context -->\n`);
        new Notice('Context injected');
      });

      for (const mem of results.results.slice(0, 8)) {
        const item = this.ctxContainer.createEl('div', { cls: 'memorius-context-item' });
        item.createEl('div', { cls: 'memorius-context-item-path', text: `${mem.shelf}/${mem.folder}/${mem.note}` });
        item.createEl('div', { cls: 'memorius-context-item-preview', text: (mem.content || '').substring(0, 150) });
      }
    } catch {
      this.ctxContainer.createEl('p', { cls: 'memorius-status-err', text: 'Failed to load context.' });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Dashboard View
// ═══════════════════════════════════════════════════════════════════════════════

class DashboardView extends ItemView {
  plugin: MemoriusVaultPlugin;
  private refreshTimer: any = null;

  constructor(leaf: WorkspaceLeaf, plugin: MemoriusVaultPlugin) { super(leaf); this.plugin = plugin; }
  getViewType(): string { return VIEW_TYPE_MEMORIUS_DASHBOARD; }
  getDisplayText(): string { return 'Memorius Dashboard'; }
  getIcon(): string { return 'bar-chart'; }

  async onOpen() {
    const c = (this.containerEl.children[1] as HTMLElement);
    c.empty(); c.addClass('memorius-container');
    this.renderDashboard(c);
    // Auto-refresh every 30s
    this.refreshTimer = setInterval(() => this.renderDashboard(c), 30000);
  }

  async renderDashboard(container: HTMLElement) {
    container.empty();
    container.createEl('div', { cls: 'memorius-header' }).createEl('h3', { text: '📊 Memorius Dashboard' });

    const body = container.createEl('div', { cls: 'memorius-dashboard-body' });
    body.createEl('p', { cls: 'memorius-loading', text: 'Loading stats...' });

    try {
      const [stats, status, diaries] = await Promise.all([
        this.plugin.getStats(),
        this.plugin.getStatus(),
        this.plugin.getDiaries(5),
      ]);

      body.empty();

      const s = stats as any;
      const st = status as any;

      // Stats cards row
      const cardsRow = body.createEl('div', { cls: 'memorius-dashboard-cards' });

      this.createStatCard(cardsRow, '🧠', 'Total Memories', s?.memory_tracking?.total ?? '—');
      this.createStatCard(cardsRow, '📁', 'Vaults', s?.memory_tracking?.by_vault?.length ?? st?.vaults ?? '—');
      this.createStatCard(cardsRow, '🔗', 'Graph Nodes', s?.knowledge_graph?.nodes ?? '—');
      this.createStatCard(cardsRow, '⚡', 'Edges', s?.knowledge_graph?.edges ?? '—');

      // Memory distribution
      if (s?.memory_tracking?.by_shelf) {
        body.createEl('h4', { text: 'Distribution by Shelf' });
        const distList = body.createEl('div', { cls: 'memorius-dist-list' });
        for (const shelf of s.memory_tracking.by_shelf) {
          const row = distList.createEl('div', { cls: 'memorius-dist-row' });
          row.createEl('span', { text: shelf.shelf || 'default' });
          row.createEl('span', { text: String(shelf.count) });
        }
      }

      // Recent diaries
      if (diaries && diaries.length > 0) {
        body.createEl('h4', { text: 'Recent Diaries' });
        const diaryList = body.createEl('div', { cls: 'memorius-diary-list' });
        for (const d of diaries.slice(0, 5)) {
          const item = diaryList.createEl('div', { cls: 'memorius-diary-item' });
          item.createEl('div', { cls: 'memorius-diary-title', text: d.title || d.session_id || 'Untitled' });
          if (d.summary) item.createEl('div', { cls: 'memorius-diary-summary', text: d.summary.substring(0, 120) });
          if (d.created_at) item.createEl('div', { cls: 'memorius-diary-date', text: d.created_at });
        }
      }

      // Quick actions
      body.createEl('h4', { text: 'Quick Actions' });
      const actions = body.createEl('div', { cls: 'memorius-dashboard-actions' });

      this.createActionBtn(actions, '🔄 Consolidate', async () => {
        const result = await this.plugin.consolidate(false);
        new Notice(`Merged: ${result.memories_merged}, Archived: ${result.memories_archived}`);
        this.renderDashboard(container);
      });

      this.createActionBtn(actions, '📥 Import Vault', async () => { await this.plugin.importEntireVault(); this.renderDashboard(container); });
      this.createActionBtn(actions, '🔍 Open Search', () => this.plugin.activateView(VIEW_TYPE_MEMORIUS_SEARCH));

    } catch (e: any) {
      body.empty();
      body.createEl('p', { cls: 'memorius-status-err', text: `Error: ${e.message}. Is the server running?` });
    }
  }

  private createStatCard(container: HTMLElement, icon: string, label: string, value: string | number) {
    const card = container.createEl('div', { cls: 'memorius-stat-card' });
    card.createEl('div', { cls: 'memorius-stat-icon', text: icon });
    card.createEl('div', { cls: 'memorius-stat-value', text: String(value) });
    card.createEl('div', { cls: 'memorius-stat-label', text: label });
  }

  private createActionBtn(container: HTMLElement, label: string, onClick: () => any) {
    const btn = container.createEl('button', { cls: 'memorius-action-btn memorius-dash-btn', text: label });
    btn.addEventListener('click', onClick);
  }

  onunload() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Semantic Graph View
// ═══════════════════════════════════════════════════════════════════════════════

class GraphView extends ItemView {
  plugin: MemoriusVaultPlugin;
  private graphContainer!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: MemoriusVaultPlugin) { super(leaf); this.plugin = plugin; }
  getViewType(): string { return VIEW_TYPE_MEMORIUS_GRAPH; }
  getDisplayText(): string { return 'Semantic Graph'; }
  getIcon(): string { return 'git-fork'; }

  async onOpen() {
    const c = (this.containerEl.children[1] as HTMLElement);
    c.empty(); c.addClass('memorius-container');

    c.createEl('div', { cls: 'memorius-header' }).createEl('h3', { text: '🔗 Semantic Graph' });

    const desc = c.createEl('p', { cls: 'memorius-hint', text: 'Shows how the current note relates to other memories.' });
    this.graphContainer = c.createEl('div', { cls: 'memorius-graph-area' });

    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.renderGraph()));
    await this.renderGraph();
  }

  async renderGraph() {
    const file = this.app.workspace.getActiveFile();
    this.graphContainer.empty();

    if (!file) {
      this.graphContainer.createEl('p', { cls: 'memorius-hint', text: 'Open a note to see its semantic graph.' });
      return;
    }

    this.graphContainer.createEl('p', { cls: 'memorius-loading', text: 'Building graph...' });

    try {
      const results = await this.plugin.search(file.basename, 15);
      this.graphContainer.empty();

      if (results.count === 0) {
        this.graphContainer.createEl('p', { cls: 'memorius-hint', text: 'No semantic connections found for this note.' });
        return;
      }

      // Header info
      const info = this.graphContainer.createEl('div', { cls: 'memorius-graph-info' });
      info.createEl('span', { text: `"${file.basename}" — ${results.count} related memories` });

      // Visual node-based representation
      const viz = this.graphContainer.createEl('div', { cls: 'memorius-graph-viz' });

      // Center node (current note)
      const centerNode = viz.createEl('div', { cls: 'memorius-graph-node memorius-graph-node-center' });
      centerNode.setText(file.basename);

      // Connected nodes with varying relevance
      for (const mem of results.results.slice(0, 10)) {
        const edge = viz.createEl('div', { cls: 'memorius-graph-edge' });
        const node = edge.createEl('div', {
          cls: `memorius-graph-node memorius-graph-node-related`,
          attr: { style: `--relevance: ${mem.score || 0.5};` },
        });

        // Node title
        node.createEl('div', { cls: 'memorius-graph-node-title', text: mem.note });
        node.createEl('div', { cls: 'memorius-graph-node-meta', text: `${mem.folder} · ${Math.round((mem.score || 0) * 100)}%` });

        // Click to open
        const notePath = mem.metadata?.path as string | undefined;
        if (notePath) {
          node.addEventListener('click', () => this.app.workspace.openLinkText(notePath, '', false));
        }

        // Show preview on hover
        const preview = node.createEl('div', { cls: 'memorius-graph-node-preview', text: (mem.content || '').substring(0, 200) });
        preview.style.display = 'none';
        node.addEventListener('mouseenter', () => preview.style.display = 'block');
        node.addEventListener('mouseleave', () => preview.style.display = 'none');
      }

    } catch (e: any) {
      this.graphContainer.createEl('p', { cls: 'memorius-status-err', text: `Error: ${e.message}` });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP Console View
// ═══════════════════════════════════════════════════════════════════════════════

class McpView extends ItemView {
  plugin: MemoriusVaultPlugin;
  private outputContainer!: HTMLElement;
  private statusEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: MemoriusVaultPlugin) { super(leaf); this.plugin = plugin; }
  getViewType(): string { return VIEW_TYPE_MEMORIUS_MCP; }
  getDisplayText(): string { return 'MCP Console'; }
  getIcon(): string { return 'terminal'; }

  async onOpen() {
    const c = (this.containerEl.children[1] as HTMLElement);
    c.empty(); c.addClass('memorius-container');

    c.createEl('div', { cls: 'memorius-header' }).createEl('h3', { text: '🖥️ MCP Server Console' });

    this.statusEl = c.createEl('div', { cls: 'memorius-status', text: '' });
    this.updateServerStatus();

    // Action buttons
    const actions = c.createEl('div', { cls: 'memorius-mcp-actions' });

    const startBtn = actions.createEl('button', { cls: 'memorius-action-btn', text: '▶️ Start Server' });
    startBtn.addEventListener('click', () => this.plugin.startMcpServer().then(() => this.updateServerStatus()));

    const stopBtn = actions.createEl('button', { cls: 'memorius-action-btn', text: '⏹️ Stop Server' });
    stopBtn.addEventListener('click', () => { this.plugin.stopMcpServer(); this.updateServerStatus(); });

    // Tool catalog
    c.createEl('h4', { text: 'Available MCP Tools' });
    const tools = c.createEl('div', { cls: 'memorius-mcp-tools' });

    const toolDefs = [
      { name: 'memorius_store',       desc: 'Store a memory in the vault' },
      { name: 'memorius_search',      desc: 'Semantic search across vault' },
      { name: 'memorius_status',      desc: 'Get vault status & stats' },
      { name: 'memorius_diary_write', desc: 'Write a session diary entry' },
      { name: 'memorius_context',     desc: 'Get context for injection' },
      { name: 'memorius_consolidate', desc: 'Merge duplicate memories' },
      { name: 'memorius_factcheck',   desc: 'Fact-check against vault' },
    ];

    for (const t of toolDefs) {
      const item = tools.createEl('div', { cls: 'memorius-mcp-tool-item' });
      item.createEl('code', { text: t.name });
      item.createEl('span', { text: t.desc });
    }

    // Quick test button
    c.createEl('h4', { text: 'Test Connection' });
    const testActions = c.createEl('div', { cls: 'memorius-mcp-actions' });

    const testSearchBtn = testActions.createEl('button', { cls: 'memorius-action-btn', text: '🔍 Test Search' });
    testSearchBtn.addEventListener('click', async () => {
      try {
        const result = await this.plugin.search('test');
        new Notice(`Search works! Found ${result.count} results`);
      } catch (e: any) {
        new Notice(`Search failed: ${e.message}`);
      }
    });

    const testStoreBtn = testActions.createEl('button', { cls: 'memorius-action-btn', text: '📝 Test Store' });
    testStoreBtn.addEventListener('click', async () => {
      try {
        await this.plugin.storeMemory('MCP console test entry', 'mcp', 'test-entry', { source: 'mcp-console' });
        new Notice('Test memory stored successfully');
      } catch (e: any) {
        new Notice(`Store failed: ${e.message}`);
      }
    });
  }

  updateServerStatus() {
    const running = this.plugin.isMcpRunning();
    this.statusEl.setText(running ? '🟢 Server running' : '🔴 Server stopped');
    this.statusEl.className = `memorius-status ${running ? 'memorius-status-ok' : 'memorius-status-err'}`;
  }

  onMcpStatusChange(running: boolean) {
    this.statusEl.setText(running ? '🟢 Server running' : '🔴 Server stopped');
    this.statusEl.className = `memorius-status ${running ? 'memorius-status-ok' : 'memorius-status-err'}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Context Inject Modal
// ═══════════════════════════════════════════════════════════════════════════════

class ContextInjectModal extends Modal {
  plugin: MemoriusVaultPlugin;
  content: string;
  private resultEl!: HTMLElement;

  constructor(app: App, plugin: MemoriusVaultPlugin, content: string) {
    super(app); this.plugin = plugin; this.content = content;
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText('🧠 Memorius Context Injection');

    contentEl.createEl('p', { text: 'Fetch related memories and inject into your note.' });

    const btnRow = contentEl.createEl('div', { cls: 'memorius-modal-actions' });
    const fetchBtn = btnRow.createEl('button', { text: 'Fetch Related Memories', cls: 'mod-cta' });
    btnRow.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());

    this.resultEl = contentEl.createEl('div', { cls: 'memorius-modal-results' });

    fetchBtn.addEventListener('click', async () => {
      fetchBtn.disabled = true; fetchBtn.setText('Fetching...');
      this.resultEl.empty();

      try {
        const title = this.app.workspace.getActiveFile()?.basename || 'unknown';
        const context = await this.plugin.getContext(title);

        this.resultEl.createEl('h4', { text: 'Related Context' });
        const pre = this.resultEl.createEl('pre', { cls: 'memorius-context-block' });
        pre.setText(context);

        const injectBtn = this.resultEl.createEl('button', { text: 'Inject into Note', cls: 'mod-cta' });
        injectBtn.addEventListener('click', () => {
          const editor = this.app.workspace.activeEditor?.editor;
          if (editor) { editor.replaceSelection(`\n\n${context}\n`); new Notice('Injected'); this.close(); }
        });
      } catch (e: any) {
        this.resultEl.createEl('p', { cls: 'memorius-status-err', text: `Error: ${e.message}` });
      } finally {
        fetchBtn.disabled = false; fetchBtn.setText('Fetch Related Memories');
      }
    });
  }

  onClose() { const { contentEl } = this; contentEl.empty(); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Settings Tab
// ═══════════════════════════════════════════════════════════════════════════════

class MemoriusSettingTab extends PluginSettingTab {
  plugin: MemoriusVaultPlugin;
  constructor(app: App, plugin: MemoriusVaultPlugin) { super(app, plugin); this.plugin = plugin; }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Memorius Vault Settings' });
    containerEl.createEl('p', { cls: 'memorius-settings-desc', text: 'Connect to the Memorius REST API server to enable semantic search, auto-sync, MCP, and memory features.' });

    // Connection
    containerEl.createEl('h3', { text: '🔌 Connection' });
    new Setting(containerEl).setName('Server URL').setDesc('REST API address').addText(t => t.setPlaceholder('http://127.0.0.1:8912').setValue(this.plugin.settings.serverUrl).onChange(async v => { this.plugin.settings.serverUrl = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Default vault').setDesc('Memorius vault name').addText(t => t.setPlaceholder('main').setValue(this.plugin.settings.defaultVault).onChange(async v => { this.plugin.settings.defaultVault = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Max results').setDesc('').addSlider(s => s.setLimits(5, 50, 5).setValue(this.plugin.settings.maxSearchResults).setDynamicTooltip().onChange(async v => { this.plugin.settings.maxSearchResults = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Test Connection').addButton(b => b.setButtonText('Test').onClick(async () => { const ok = await this.plugin.checkHealth(); new Notice(ok ? '✅ Connected' : '❌ Cannot reach'); }));

    // Sync
    containerEl.createEl('h3', { text: '🔄 Auto-Sync' });
    new Setting(containerEl).setName('Auto-sync').setDesc('Import notes to Memorius on create/modify').addToggle(t => t.setValue(this.plugin.settings.autoSync).onChange(async v => { this.plugin.settings.autoSync = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Sync delay (ms)').setDesc('Debounce delay for sync').addSlider(s => s.setLimits(500, 5000, 500).setValue(this.plugin.settings.autoSyncDelay).setDynamicTooltip().onChange(async v => { this.plugin.settings.autoSyncDelay = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Sync on startup').setDesc('Import entire vault on plugin load').addToggle(t => t.setValue(this.plugin.settings.syncOnStartup).onChange(async v => { this.plugin.settings.syncOnStartup = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).addButton(b => b.setButtonText('Import All Notes Now').onClick(() => this.plugin.importEntireVault()));

    // MCP
    containerEl.createEl('h3', { text: '🖥️ MCP Server' });
    new Setting(containerEl).setName('MCP command').setDesc('Path/command to start Memorius MCP').addText(t => t.setPlaceholder('memorius').setValue(this.plugin.settings.mcpServerPath).onChange(async v => { this.plugin.settings.mcpServerPath = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Start MCP on load').addToggle(t => t.setValue(this.plugin.settings.mcpAutoStart).onChange(async v => { this.plugin.settings.mcpAutoStart = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).addButton(b => b.setButtonText('▶️ Start MCP').onClick(() => this.plugin.startMcpServer()));
    new Setting(containerEl).addButton(b => b.setButtonText('⏹️ Stop MCP').onClick(() => this.plugin.stopMcpServer()));

    // Status
    containerEl.createEl('h3', { text: '📊 Display' });
    new Setting(containerEl).setName('Show status bar').addToggle(t => t.setValue(this.plugin.settings.showStatusBar).onChange(async v => { this.plugin.settings.showStatusBar = v; await this.plugin.saveSettings(); }));

    // Actions
    containerEl.createEl('h3', { text: '⚡ Actions' });
    new Setting(containerEl).addButton(b => b.setButtonText('🔄 Consolidate Memories').onClick(() => this.plugin.runConsolidate()));
    new Setting(containerEl).addButton(b => b.setButtonText('📥 Import All Notes').onClick(() => this.plugin.importEntireVault()));

    // Guide
    containerEl.createEl('h3', { text: '📖 Quick Start' });
    const guide = containerEl.createEl('div', { cls: 'memorius-guide' });
    guide.createEl('p', { text: '1. Start the Memorius server: memorius serve' });
    guide.createEl('p', { text: '2. Use ribbon icons or Cmd+P → "Memorius" to access all features' });
    guide.createEl('p', { text: '3. Enable auto-sync to keep Memorius in sync with vault changes' });
    guide.createEl('p', { text: '4. Start the MCP server so AI agents can query memories directly' });
  }
}
