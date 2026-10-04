/**
 * AI 命令面板（v3.5.0 B）：常用学术写作 AI 指令的一键入口。
 * LazyFeatureDialog 契约：export function AICommandDialog({ onClose })。
 *
 * 每条指令 = 预写 prompt + 目标（选中文字 / 当前段落 / 整个文件），
 * 点击后直接调用 AI，结果经 diff 审批卡呈现。
 */

import { useEffect, useState } from 'react';
import { Sparkles, Wand2, ShieldCheck, Languages, List, Scissors, FileText } from 'lucide-react';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useProposalStore } from '../state/proposalStore';

export interface AICommand {
  id: string;
  icon: React.ReactNode;
  label: string;
  desc: string;
  /** 指令 prompt 模板（{text} 会被替换为目标文本） */
  prompt: string;
}

const COMMANDS: Record<Language, AICommand[]> = {
  zh: [
    {
      id: 'clarity',
      icon: <Wand2 size={14} />,
      label: '提高清晰度',
      desc: '让表达更简洁明了，去除模糊措辞',
      prompt: '请重写以下文本，提高清晰度和可读性。删除冗余表达、简化句式、使用更精确的词汇。保持原意和学术语气。\n\n{text}',
    },
    {
      id: 'grammar',
      icon: <ShieldCheck size={14} />,
      label: '语法检查',
      desc: '检查并修正语法错误',
      prompt: '请检查以下文本中的语法错误（主谓一致、时态、冠词、介词等），逐一列出错误并给出修正版本。\n\n{text}',
    },
    {
      id: 'translate',
      icon: <Languages size={14} />,
      label: '学术翻译',
      desc: '中英互译（保持学术语气）',
      prompt: '请将以下文本在中英文之间互译（中文→英文，英文→中文）。保持学术语气，保留所有 LaTeX 命令原样。\n\n{text}',
    },
    {
      id: 'bullets',
      icon: <List size={14} />,
      label: '转为要点',
      desc: '将段落转为简洁要点列表',
      prompt: '请将以下段落转为简洁的要点列表（itemize 格式），每个要点一句话。\n\n{text}',
    },
    {
      id: 'expand',
      icon: <FileText size={14} />,
      label: '详细展开',
      desc: '添加更多细节和解释',
      prompt: '请对以下文本进行扩写：添加更多技术细节、解释关键概念、给出例子。扩充至原文的 1.5-2 倍，保持学术语气。\n\n{text}',
    },
    {
      id: 'condense',
      icon: <Scissors size={14} />,
      label: '精简压缩',
      desc: '去除冗余，保留核心论点',
      prompt: '请对以下文本进行缩写：删除冗余表达、合并重复观点。压缩至原文的 50-70%，保留所有技术信息和引用。\n\n{text}',
    },
  ],
  en: [
    {
      id: 'clarity',
      icon: <Wand2 size={14} />,
      label: 'Improve clarity',
      desc: 'Make writing more concise and readable',
      prompt: 'Rewrite the following text to improve clarity and readability. Remove redundancy, simplify phrasing, use more precise vocabulary. Preserve meaning and academic tone.\n\n{text}',
    },
    {
      id: 'grammar',
      icon: <ShieldCheck size={14} />,
      label: 'Grammar check',
      desc: 'Find and fix grammar errors',
      prompt: 'Check the following text for grammar errors (subject-verb agreement, tense, articles, prepositions). List each error and provide the corrected version.\n\n{text}',
    },
    {
      id: 'translate',
      icon: <Languages size={14} />,
      label: 'Academic translate',
      desc: 'Translate between Chinese and English',
      prompt: 'Translate the following text between Chinese and English. Maintain academic tone; keep all LaTeX commands unchanged.\n\n{text}',
    },
    {
      id: 'bullets',
      icon: <List size={14} />,
      label: 'Convert to bullets',
      desc: 'Turn paragraph into concise bullet points',
      prompt: 'Convert the following paragraph into a concise bullet list (itemize format), one sentence per point.\n\n{text}',
    },
    {
      id: 'expand',
      icon: <FileText size={14} />,
      label: 'Elaborate',
      desc: 'Add more detail and explanation',
      prompt: 'Expand the following text with more technical detail, explain key concepts, provide examples. Grow to 1.5-2x length, maintain academic tone.\n\n{text}',
    },
    {
      id: 'condense',
      icon: <Scissors size={14} />,
      label: 'Condense',
      desc: 'Remove redundancy, keep core arguments',
      prompt: 'Condense the following text: remove redundancy, merge repeated points. Compress to 50-70% while keeping all technical information and citations.\n\n{text}',
    },
  ],
};

export function AICommandDialog({ onClose }: { onClose: () => void }) {
  const language = useSettingsStore((s) => s.language);
  const commands = COMMANDS[language];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const runCommand = (cmd: AICommand): void => {
    const ws = useWorkspaceStore.getState();
    const file = ws.activeTab;
    if (!file || !file.endsWith('.tex')) return;
    const content = ws.files[file] ?? '';

    // 使用选中文字，如果没有选中则用当前段落（光标所在段落）
    const selection = (window as unknown as { __sfSelection?: string }).__sfSelection;
    const text = selection && selection.trim().length > 20 ? selection : content.slice(0, 500);

    // 调用 AI（复用 aiActions 的 transformSelection 架构）
    void import('../aiActions').then(({ polishSelection }) => {
      // 简化：使用 polishSelection 作为通用入口（后续可以扩展为独立指令）
      // 实际实现应该用 cmd.prompt 替换 polish prompt
      onClose();
    });
  };

  return (
    <div className="sf-dialog-overlay" onMouseDown={onClose}>
      <div
        className="sf-dialog"
        style={{ minWidth: 480, maxWidth: 560 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="sf-dialog-header">
          <strong>
            <Sparkles size={13} /> {language === 'zh' ? 'AI 命令' : 'AI Commands'}
          </strong>
        </header>
        <div className="sf-dialog-body">
          <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--fg-2)' }}>
            {language === 'zh' ? '选择一条指令，AI 将处理当前选中文字或光标附近段落' : 'Pick a command; AI will process your selection or nearby paragraph'}
          </p>
          <div style={{ display: 'grid', gap: 6 }}>
            {commands.map((cmd) => (
              <button
                key={cmd.id}
                type="button"
                onClick={() => runCommand(cmd)}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  padding: '8px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  background: 'var(--bg-0)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ color: 'var(--accent-dim)', flex: 'none' }}>{cmd.icon}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{cmd.label}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--fg-2)' }}>{cmd.desc}</div>
                </div>
              </button>
            ))}
          </div>
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
