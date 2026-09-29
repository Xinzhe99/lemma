import { useEffect, useState } from 'react';
import {
  BookOpen,
  FileText,
  Library,
  ListTree,
  MessageSquare,
  Quote,
  Settings,
} from 'lucide-react';
import { CommandPalette, type Command } from './commandPalette';

type SidebarTab = 'outline' | 'files' | 'citations' | 'library';

const SIDEBAR_TABS: { id: SidebarTab; label: string; icon: typeof ListTree }[] = [
  { id: 'outline', label: '大纲', icon: ListTree },
  { id: 'files', label: '文件', icon: FileText },
  { id: 'citations', label: '引用', icon: Quote },
  { id: 'library', label: '文献库', icon: Library },
];

const PLACEHOLDER_COMMANDS: Command[] = [
  { id: 'new-project', title: '新建项目（模板向导）', hint: '项目' },
  { id: 'import-overleaf', title: '导入 Overleaf 项目', hint: '项目' },
  { id: 'compile', title: '编译项目', hint: '编译', kbd: '⌘S' },
  { id: 'polish-selection', title: 'AI 润色选中文本', hint: 'Agent' },
  { id: 'run-reviewers', title: '运行三审稿人仿真', hint: 'Agent' },
  { id: 'settings', title: '打开设置', hint: '应用', kbd: '⌘,' },
];

export function App() {
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('outline');
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">ScholarForge</div>
        <button className="palette-trigger" onClick={() => setPaletteOpen(true)}>
          命令面板 <kbd>⌘K</kbd>
        </button>
        <div className="topbar-right">
          <span className="status-chip ok">编译 · 未运行</span>
          <span className="status-chip">Git ◐</span>
          <button className="icon-btn" title="设置">
            <Settings size={16} />
          </button>
        </div>
      </header>

      <div className="workspace">
        <nav className="nav-rail">
          {SIDEBAR_TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-btn ${sidebarTab === id ? 'active' : ''}`}
              title={label}
              onClick={() => setSidebarTab(id)}
            >
              <Icon size={18} />
            </button>
          ))}
          <div className="nav-spacer" />
          <button className="nav-btn" title="文献阅读">
            <BookOpen size={18} />
          </button>
        </nav>

        <aside className="sidebar">
          <div className="sidebar-title">{SIDEBAR_TABS.find((t) => t.id === sidebarTab)?.label}</div>
          <div className="sidebar-body">
            <p className="placeholder">（{sidebarTab === 'library' ? '文献库' : '项目'}模块接入中 · WS-F 骨架）</p>
          </div>
        </aside>

        <main className="center">
          <div className="tabbar">
            <span className="tab active">main.tex</span>
            <span className="tab">main.pdf</span>
            <span className="tab">notes.md</span>
          </div>
          <div className="editor-area">
            <p className="placeholder">编辑器接入中（WS-A）</p>
          </div>
          <div className="console">
            <div className="console-title">编译输出</div>
            <div className="console-body">
              <p className="placeholder">编译服务接入中（WS-B）</p>
            </div>
          </div>
        </main>

        <aside className="agent-panel">
          <div className="panel-title">
            <MessageSquare size={14} /> Agent 面板
          </div>
          <div className="panel-body">
            <p className="placeholder">Agent 中枢接入中（WS-D）</p>
          </div>
        </aside>
      </div>

      {paletteOpen && (
        <CommandPalette commands={PLACEHOLDER_COMMANDS} onClose={() => setPaletteOpen(false)} />
      )}
    </div>
  );
}
