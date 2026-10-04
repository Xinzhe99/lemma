/**
 * 编辑区：把 @lemma/editor 接入工作区文件系统。
 * \cite 补全数据 = 文献库条目 + 项目 .bib 条目；挂载行级跳转桥；
 * 「选中即问」：选中文本后浮动 AI 操作条（润色/解释/翻译/找文献，设计 3.2）。
 * 宿主为 flex 列布局：编辑器占满，底部为 StatusBar（字数/行数/光标行列/保存状态）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Image, Quote, Table } from 'lucide-react';
import {
  EditorView,
  LatexEditor,
  quickFixExtension,
  compileDiagnosticsExtension,
  collectLabels,
  clipboardToTable,
  spellcheckExtension,
  thesaurusExtension,
  citationHoverExtension,
  sentenceQualityExtension,
  envAutoCloseExtension,
  bibValidationExtension,
  selectionContextMenu,
  commentToggleKeymap,
  textFormatKeymap,
  type CitationCard,
} from '@lemma/editor';
// 字号调节用的 CodeMirror 底层件（@lemma/editor 同源依赖，非新增包）
import { keymap, type KeyBinding } from '@codemirror/view';
import { Compartment, type Extension } from '@codemirror/state';
// KaTeX 渲染所需样式（mathPreview hover 浮层；经 vite 打包，不改任何 .css 文件）
import 'katex/dist/katex.min.css';
import { useT } from '../i18n';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useLibraryStore } from '../state/libraryStore';
import { useWritingStatsStore } from '../state/writingStats';
import { useProposalStore } from '../state/proposalStore';
import { useUiStore } from '../state/uiStore';
import { useSettingsStore } from '../state/settingsStore';
import { bibEntries } from '../projectDoc';
import { setJumpHandler, stashPendingJump, takePendingJump, notifyCursor } from '../editorJump';
import { setInsertHandler } from '../editorInsert';
import { polishSelection, quickAsk, paraphraseSelection, expandSelection, condenseSelection } from '../aiActions';
import { StatusBar } from './StatusBar';

const TEXT_EXT = /\.(tex|bib|md|txt|sty|cls|bst)$/i;

// ---------------------------------------------------------------------------
// 编辑器字号调节（Ctrl+= / Ctrl++ 放大、Ctrl+- 缩小、Ctrl+0 重置）
// ---------------------------------------------------------------------------

export const FONT_SIZE_STORAGE_KEY = 'sf-editor-fontsize';
export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 24;
export const FONT_SIZE_DEFAULT = 14;

/** 钳制到 10–24px（非有限值回落默认 14；步进 1 取整） */
export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return FONT_SIZE_DEFAULT;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(size)));
}

/** 挂载时读取持久化字号（缺失/空串/损坏/越界回落默认或钳制值） */
export function loadFontSize(): number {
  try {
    const raw =
      typeof localStorage === 'undefined' ? null : localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    if (raw === null || raw.trim() === '') return FONT_SIZE_DEFAULT;
    return clampFontSize(Number(raw));
  } catch {
    return FONT_SIZE_DEFAULT;
  }
}

/** 字号持久化（始终写钳制后的值；写失败静默） */
export function saveFontSize(size: number): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(clampFontSize(size)));
    }
  } catch {
    /* 持久化失败不打断 UI */
  }
}

/**
 * 字号快捷键纯函数：'=' / '+' → +1、'-' → -1、'0' → 重置 14，均经边界钳制；
 * 其余按键返回 null（非字号快捷键，交回默认处理）。
 */
export function handleFontSizeKey(key: string, current: number): number | null {
  if (key === '=' || key === '+') return clampFontSize(current + 1);
  if (key === '-') return clampFontSize(current - 1);
  if (key === '0') return FONT_SIZE_DEFAULT;
  return null;
}

/** 字号主题（经 Compartment 重设）：EditorView.theme({'&': {fontSize}}) */
function fontSizeThemeOf(size: number): Extension {
  return EditorView.theme({ '&': { fontSize: `${clampFontSize(size)}px` } });
}

function scrollToLine(view: EditorView, line: number): void {
  const clamped = Math.min(Math.max(1, line), view.state.doc.lines);
  const pos = view.state.doc.line(clamped).from;
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'center' }),
  });
  view.focus();
}

/** 选区跟踪扩展：把当前选中文本同步到 uiStore（空选区 → ''） */
const selectionTracker = EditorView.updateListener.of((update) => {
  if (!update.selectionSet) return;
  const sel = update.state.selection.main;
  const text = sel.empty ? '' : update.state.doc.sliceString(sel.from, sel.to);
  const store = useUiStore.getState();
  if (store.selectionText !== text) store.setSelectionText(text.length > 8000 ? '' : text);
});

export function EditorArea() {
  const t = useT();
  const files = useWorkspaceStore((s) => s.files);
  const activeTab = useWorkspaceStore((s) => s.activeTab);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const updateFile = useWorkspaceStore((s) => s.updateFile);
  const papers = useLibraryStore((s) => s.papers);
  const selectionText = useUiStore((s) => s.selectionText);

  // 改写变体（v1.6.0 ②）：paraphraseSelection 产出，浮层点选后走 diff 审批
  const [paraphraseVariants, setParaphraseVariants] = useState<string[] | null>(null);
  const [paraphraseBusy, setParaphraseBusy] = useState(false);
  const setSelectionText = useUiStore((s) => s.setSelectionText);
  // 拼写/用词检查开关（命令 edit.spellcheck 切换）：变化时经下方 useMemo 重建扩展，
  // LatexEditor 的 extraExtensions compartment 随数组身份变化整体重配——等效 Compartment 切换
  const spellcheckEnabled = useUiStore((s) => s.spellcheckEnabled);

  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const viewRef = useRef<EditorView | null>(null);

  // 光标行列跟踪（状态栏数据源）：LatexEditor 的 onCursorLine 仅回报行号，
  // 这里经 extraExtensions 挂选区监听，同时取到列号（head 相对行首的偏移）。
  // 同步写入光标桥（notifyCursor）：批注面板等经 subscribeCursor 响应式获知
  // 「光标是否在当前文件内」（D1 修复：光标桥此前从未被通知，添加批注按钮恒禁用）。
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const cursorTracker = useMemo(
    () =>
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet && !update.docChanged) return;
        const head = update.state.selection.main.head;
        const line = update.state.doc.lineAt(head);
        const info = { line: line.number, col: head - line.from + 1 };
        setCursor(info);
        notifyCursor({ file: activeTabRef.current ?? '', ...info });
      }),
    [],
  );
  // quickFixExtension 追加在末位：多个 hover 源同点堆叠时位于最内层（最贴近文本，更具体）；
  // 编译诊断扩展绑定当前文件名（activeTab 变化需整体重配）
  // 引用悬停数据源：citekey → 文献卡（标题/首作者/年份/阅读状态/有无 PDF）
  /** 从剪贴板读取表格数据并插入为 LaTeX tabular（v3.1.0 ①） */
  const pasteTableFromClipboard = useCallback(async (): Promise<void> => {
    try {
      const clipText = await navigator.clipboard.readText();
      const latex = clipboardToTable(clipText);
      if (!latex) return;
      const ws = useWorkspaceStore.getState();
      const file = ws.activeTab;
      if (!file || !file.endsWith('.tex')) return;
      const before = ws.files[file] ?? '';
      const after = before.endsWith('\n') ? before + latex + '\n' : before + '\n\n' + latex + '\n';
      ws.updateFile(file, after);
    } catch {
      // 剪贴板读取失败（权限/无表格数据）—— 静默
    }
  }, []);

  const paperCard = useCallback(
    (citekey: string): CitationCard | undefined => {
      const p = useLibraryStore.getState().papers.find((x) => x.citekey === citekey);
      if (!p) return undefined;
      const first = p.authors?.[0];
      return {
        title: p.title ?? '(untitled)',
        firstAuthor: first ? (p.authors.length > 1 ? first.family + ' et al.' : first.family) : undefined,
        year: p.year ? String(p.year) : undefined,
        readStatus: p.readStatus,
        hasPdf: !!p.pdfPath,
      };
    },
    [],
  );
  // 全项目 label（v2.3.0：
  // 全项目 label（v2.3.0：ref 补全跨文件——收集所有 .tex 的 label，标注来源文件）
  const projectLabels = useCallback(() => {
    const ws = useWorkspaceStore.getState();
    const out: { name: string; line: number; file?: string }[] = [];
    for (const [path, content] of Object.entries(ws.files)) {
      if (!path.toLowerCase().endsWith('.tex')) continue;
      if (path === (useWorkspaceStore.getState().activeTab ?? '')) continue; // 本文件的 refCompletion 已覆盖
      for (const node of collectLabels(content)) {
        out.push({ name: node.name, line: node.line, file: path });
      }
    }
    return out;
  }, []);

  const openCitePdf = useCallback((citekey: string): void => {
    const p = useLibraryStore.getState().papers.find((x) => x.citekey === citekey);
    if (p) useLibraryStore.getState().openPdf(p.id);
  }, []);

  const extraExtensions = useMemo(
    () => [
      selectionTracker,
      cursorTracker,
      spellcheckExtension(spellcheckEnabled),
      thesaurusExtension(),
      sentenceQualityExtension(),
      envAutoCloseExtension(),
      textFormatKeymap(),
      commentToggleKeymap(),
      selectionContextMenu({
        onAIPolish: (t) => void polishSelection(t),
        onAIExpand: (t) => void expandSelection(t),
        onAICondense: (t) => void condenseSelection(t),
        onPasteTable: () => void pasteTableFromClipboard(),
      }),
      citationHoverExtension(paperCard, openCitePdf),
      quickFixExtension(),
      compileDiagnosticsExtension(activeTab ?? ''),
      ...(activeTab?.toLowerCase().endsWith('.bib') ? [bibValidationExtension()] : []),
    ],
    [cursorTracker, spellcheckEnabled, activeTab, paperCard, openCitePdf],
  );

  // —— 编辑器字号调节（挂载时读取 localStorage，快捷键经 Compartment 重设主题）——
  const [fontSize, setFontSize] = useState<number>(loadFontSize);
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  const fontCompartmentRef = useRef<Compartment | null>(null);
  if (fontCompartmentRef.current === null) fontCompartmentRef.current = new Compartment();
  const fontCompartment = fontCompartmentRef.current;

  const fontKeymap = useMemo(() => {
    const bump = (key: string) => () => {
      const next = handleFontSizeKey(key, fontSizeRef.current);
      if (next !== null) setFontSize(next);
      return next !== null;
    };
    const bindings: KeyBinding[] = [
      { key: 'Mod-=', preventDefault: true, run: bump('=') },
      { key: 'Mod-+', preventDefault: true, run: bump('+') },
      { key: 'Mod--', preventDefault: true, run: bump('-') },
      { key: 'Mod-0', preventDefault: true, run: bump('0') },
    ];
    return keymap.of(bindings);
  }, []);

  // extraExtensions 含字号 compartment（LatexEditor 侧外层 Compartment 会随数组变化整体重配）
  const editorExtensions = useMemo(
    () => [...extraExtensions, fontKeymap, fontCompartment.of(fontSizeThemeOf(fontSize))],
    [extraExtensions, fontKeymap, fontCompartment, fontSize],
  );

  // 字号变化：持久化 + 经 Compartment 重设 EditorView.theme({'&': {fontSize}})
  useEffect(() => {
    saveFontSize(fontSize);
    const view = viewRef.current;
    if (view) view.dispatch({ effects: fontCompartment.reconfigure(fontSizeThemeOf(fontSize)) });
  }, [fontSize, fontCompartment]);


  // 行级跳转桥：同文件直接滚动定位；跨文件先 openFile + 暂存，待新编辑器就绪后消费
  useEffect(() => {
    setJumpHandler((target) => {
      if (target.file !== activeTabRef.current) {
        stashPendingJump(target);
        openFile(target.file);
      } else {
        const view = viewRef.current;
        if (view) scrollToLine(view, target.line);
      }
    });
    return () => setJumpHandler(null);
  }, [openFile]);

  // 表格代码插入桥：TableEditor 经 insertAtCursor 把 tabular 写入当前编辑器光标处；卸载清理
  useEffect(() => {
    setInsertHandler((code) => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch(view.state.replaceSelection(code));
      view.focus();
    });
    return () => setInsertHandler(null);
  }, []);

  // 标签栏动作位「表格」「插图」「引用」按钮：动作区渲染在 App 内的 EditorTabs（本工作流不改 App），
  // 用 portal 注入 .tabbar-actions（润色/历史 旁）；PDF 页签替换标签栏时自动隐藏。
  const language = useSettingsStore((s) => s.language);
  const [tabActionsHost, setTabActionsHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const sync = () => setTabActionsHost(document.querySelector<HTMLElement>('.tabbar-actions'));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  const tableAction = tabActionsHost ? (
    createPortal(
      <>
        <button
          className="tab-action"
          title={
            language === 'en'
              ? 'Visual table editor (insert tabular at cursor)'
              : '可视化表格编辑器（插入 tabular 到光标处）'
          }
          onClick={() => useUiStore.getState().setTableEditorOpen(true)}
        >
          <Table size={13} /> {language === 'en' ? 'Table' : '表格'}
        </button>
        <button
          className="tab-action"
          title={
            language === 'en'
              ? 'Figure wizard (pick image, insert \\includegraphics at cursor)'
              : '插图向导（选图并插入 \\includegraphics 到光标处）'
          }
          onClick={() => useUiStore.getState().setImageWizardOpen(true)}
        >
          <Image size={13} /> {language === 'en' ? 'Figure' : '插图'}
        </button>
        <button
          className="tab-action"
          title={
            language === 'en'
              ? 'Citation picker (search library / smart suggest, insert \\cite at cursor)'
              : '引用插入向导（文献库搜索 / 智能推荐，插入 \\cite 到光标处）'
          }
          onClick={() => useUiStore.getState().setCitationPickerOpen(true)}
        >
          <Quote size={13} /> {language === 'en' ? 'Cite' : '引用'}
        </button>
      </>,
      tabActionsHost,
    )
  ) : null;

  const citations = useMemo(() => {
    const seen = new Set<string>();
    const push = (c: { citekey: string; title: string; year?: number }) =>
      c.citekey && !seen.has(c.citekey) ? (seen.add(c.citekey), c) : null;
    return [
      ...papers
        .map((p) => push({ citekey: p.citekey, title: p.title, year: p.year }))
        .filter((c): c is { citekey: string; title: string; year?: number } => c !== null),
      ...bibEntries(files)
        .map((b) => push({ citekey: b.citekey, title: b.title, year: b.year }))
        .filter((c): c is { citekey: string; title: string; year?: number } => c !== null),
    ];
  }, [papers, files]);

  if (!activeTab) {
    return (
      <div className="sf-editor-host" style={{ display: 'flex', flexDirection: 'column' }}>
        {tableAction}
        <div className="sf-editor-placeholder" style={{ flex: 1, minHeight: 0, justifyContent: 'center' }}>
          <p className="placeholder">{t('editor.pending')}</p>
        </div>
        <StatusBar />
      </div>
    );
  }

  if (!TEXT_EXT.test(activeTab)) {
    return (
      <div className="sf-editor-host" style={{ display: 'flex', flexDirection: 'column' }}>
        {tableAction}
        <div
          className="sf-editor-placeholder"
          style={{ flex: 1, minHeight: 0, justifyContent: 'center' }}
        >
          <div className="sf-editor-file">{activeTab}</div>
          <p className="placeholder">{t('editor.unsupportedType')}</p>
        </div>
        <StatusBar />
      </div>
    );
  }

  const content = files[activeTab] ?? '';

  return (
    <div className="sf-editor-host" style={{ display: 'flex', flexDirection: 'column' }}>
      {tableAction}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {selectionText && activeTab.endsWith('.tex') && (
          <div className="sf-selbar">
            <span className="sf-selbar-label">{t('selbar.selected', { n: selectionText.length })}</span>
            <button className="sf-btn" onClick={() => void polishSelection(selectionText)}>
              {t('selbar.polish')}
            </button>
            <button
              className="sf-btn"
              disabled={paraphraseBusy}
              onClick={() => {
                setParaphraseBusy(true);
                setParaphraseVariants(null);
                void paraphraseSelection(selectionText)
                  .then((vs) => setParaphraseVariants(vs))
                  .finally(() => setParaphraseBusy(false));
              }}
            >
              {paraphraseBusy ? t('selbar.paraphraseBusy') : t('selbar.paraphrase')}
            </button>
            <button className="sf-btn" onClick={() => quickAsk('explain', selectionText)}>
              {t('selbar.explain')}
            </button>
            <button className="sf-btn" onClick={() => quickAsk('translate', selectionText)}>
              {t('selbar.translate')}
            </button>
            <button className="sf-btn" onClick={() => quickAsk('find', selectionText)}>
              {t('selbar.find')}
            </button>
            <button
              className="sf-link-btn"
              onClick={() => {
                setSelectionText('');
                setParaphraseVariants(null);
              }}
              title={t('selbar.clear')}
            >
              ×
            </button>
          </div>
        )}
        {paraphraseVariants !== null && paraphraseVariants.length > 0 && activeTab.endsWith('.tex') && (
          <div
            className="sf-paraphrase-pop"
            style={{
              position: 'absolute',
              zIndex: 30,
              top: 44,
              right: 16,
              width: 420,
              maxHeight: 260,
              overflowY: 'auto',
              background: 'var(--bg-0)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-pop)',
              padding: 10,
            }}
          >
            <div style={{ fontSize: 11.5, color: 'var(--fg-2)', marginBottom: 6 }}>
              {t('selbar.paraphraseTitle')}
            </div>
            {paraphraseVariants.map((v, i) => (
              <button
                key={i}
                type="button"
                className="sf-paraphrase-item"
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  background: 'var(--bg-0)',
                  padding: '6px 10px',
                  marginBottom: 6,
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  cursor: 'pointer',
                  color: 'var(--fg-0)',
                }}
                onClick={() => {
                  const ws = useWorkspaceStore.getState();
                  const file = ws.activeTab;
                  if (!file) return;
                  const before = ws.files[file] ?? '';
                  if (!before.includes(selectionText)) return;
                  useProposalStore.getState().setProposal({
                    file,
                    before,
                    after: before.replace(selectionText, v),
                    kind: 'polish',
                    label: '改写变体 ' + (i + 1),
                    via: 'paraphrase',
                  });
                  setParaphraseVariants(null);
                }}
              >
                {v}
              </button>
            ))}
          </div>
        )}
        <LatexEditor
          key={activeTab}
          value={content}
          onChange={(v) => {
            updateFile(activeTab, v);
            useWritingStatsStore.getState().recordFocusTick();
          }}
          filePath={activeTab}
          getCitations={() => citations}
          getProjectLabels={projectLabels}
          extraExtensions={editorExtensions}
          onEditorReady={(view) => {
            viewRef.current = view;
            if (view) {
              const head = view.state.selection.main.head;
              const line = view.state.doc.lineAt(head);
              const info = { line: line.number, col: head - line.from + 1 };
              setCursor(info);
              // 编辑器刚挂载（选区监听尚未触发）：手动把初始光标写入光标桥，
              // 保证文件切换/兜底跳转后批注按钮立即可判定可用性
              notifyCursor({ file: activeTabRef.current ?? '', ...info });
              const target = takePendingJump(activeTab);
              if (target) scrollToLine(view, target.line);
            }
          }}
        />
      </div>
      <StatusBar cursor={cursor} />
    </div>
  );
}
