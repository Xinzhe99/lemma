/**
 * 使用帮助面板（v3.4.0 C）：应用内离线文档——常见任务的步骤指引。
 * LazyFeatureDialog 契约：export function HelpPanelDialog({ onClose })。
 */

import { useEffect, useState } from 'react';
import { BookOpen, Keyboard, Search, Sparkles, Upload } from 'lucide-react';
import { useSettingsStore, type Language } from '../state/settingsStore';

interface HelpTopic {
  icon: React.ReactNode;
  title: string;
  steps: string[];
}

function buildTopics(lang: Language): HelpTopic[] {
  const zh = lang === 'zh';
  return [
    {
      icon: <Upload size={14} />,
      title: zh ? '如何创建新项目' : 'Create a new project',
      steps: zh ? [
        '按 Ctrl+K 打开命令面板',
        '搜索「新建」或「模板」',
        '从 6 种内置模板中选择（IEEE / ML 预印本 / 中文等）',
        '填入项目名，点击创建',
      ] : [
        'Press Ctrl+K to open the command palette',
        'Search for "new" or "template"',
        'Choose from 6 built-in templates (IEEE / ML preprint / Chinese, etc.)',
        'Enter a project name and click create',
      ],
    },
    {
      icon: <Search size={14} />,
      title: zh ? '如何添加引用文献' : 'How to add citations',
      steps: zh ? [
        '方式一：Ctrl+K → 「快速添加引用」→ 粘贴 DOI 或 arXiv ID',
        '方式二：文献库面板 → BibTeX / RIS / Zotero 导入',
        '方式三：文献库「发现」→ 搜索 arXiv / Crossref → 一键入库',
        '入库后在编辑器输入 \\cite{ 即可自动补全',
      ] : [
        'Method 1: Ctrl+K → "Quick add citation" → paste DOI or arXiv ID',
        'Method 2: Library panel → BibTeX / RIS / Zotero import',
        'Method 3: Library "Discover" → search arXiv / Crossref → one-click import',
        'Type \\cite{ in the editor to autocomplete after import',
      ],
    },
    {
      icon: <Sparkles size={14} />,
      title: zh ? '如何配置 AI 功能' : 'How to configure AI',
      steps: zh ? [
        '按 Ctrl+, 打开设置',
        '在「模型服务」页点击「新增服务」',
        '从预设选择服务商（DeepSeek / GLM / Kimi 等 7 家）',
        '填入 API Key → 点击「测试连接」→ 「保存并激活」',
        '未配置时应用运行于演示模式（所有 AI 功能有高质量示例）',
      ] : [
        'Press Ctrl+, to open settings',
        'In "Model Services" page, click "Add service"',
        'Choose a provider from presets (DeepSeek / GLM / Kimi, etc.)',
        'Enter API Key → "Test connection" → "Save & activate"',
        'Without config, the app runs in demo mode with high-quality examples',
      ],
    },
    {
      icon: <Keyboard size={14} />,
      title: zh ? '常用快捷键' : 'Common shortcuts',
      steps: zh ? [
        'Ctrl+K：命令面板（所有功能入口）',
        'Ctrl+Enter：编译',
        'Ctrl+P：快速打开文件',
        'Ctrl+B / Ctrl+I：粗体 / 斜体',
        'Ctrl+/：注释切换',
        'Ctrl+/（按住 Ctrl 再按 /）：快捷键完整列表',
      ] : [
        'Ctrl+K: Command palette (everything)',
        'Ctrl+Enter: Compile',
        'Ctrl+P: Quick open file',
        'Ctrl+B / Ctrl+I: Bold / Italic',
        'Ctrl+/: Toggle comment',
      ],
    },
    {
      icon: <BookOpen size={14} />,
      title: zh ? '编译不通过怎么办' : 'Compilation fails',
      steps: zh ? [
        '查看控制台日志（底部面板），错误行会标红',
        '编辑器中错误行有沟槽标记（✗/⚠），悬停看详情',
        '日志中的错误已附中文解释和修复建议',
        'AI 修复：Ctrl+K → 「AI 修复编译错误」',
        '首次编译自动下载 Tectonic 引擎（约 30MB，需联网）',
      ] : [
        'Check the console log (bottom panel); errors are highlighted',
        'Editor shows gutter marks (✗/⚠) on error lines; hover for details',
        'Log errors include Chinese explanations and fix suggestions',
        'AI fix: Ctrl+K → "AI fix compile errors"',
        'First compile auto-downloads Tectonic engine (~30MB, needs internet)',
      ],
    },
  ];
}

export function HelpPanelDialog({ onClose }: { onClose: () => void }) {
  const language = useSettingsStore((s) => s.language);
  const topics = buildTopics(language);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sf-dialog-overlay" onMouseDown={onClose}>
      <div
        className="sf-dialog"
        style={{ minWidth: 520, maxWidth: 620, maxHeight: '80vh', overflowY: 'auto' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="sf-dialog-header">
          <strong>{language === 'zh' ? '使用帮助' : 'Help'}</strong>
        </header>
        <div className="sf-dialog-body">
          {topics.map((topic, i) => (
            <section key={i} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <span style={{ color: 'var(--accent-dim)' }}>{topic.icon}</span>
                <strong style={{ fontSize: 13 }}>{topic.title}</strong>
              </div>
              <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>
                {topic.steps.map((step, j) => (
                  <li key={j} style={{ fontSize: 12.5, color: 'var(--fg-1)', lineHeight: 1.5 }}>
                    {step}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
        <footer style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px' }}>
          <button className="sf-btn dim" onClick={onClose}>
            {language === 'zh' ? '关闭' : 'Close'}
          </button>
        </footer>
      </div>
    </div>
  );
}
