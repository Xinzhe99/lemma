/**
 * 大纲面板：跨全部 .tex 文件的章节树，点击跳转到对应文件与行。
 * 顶部「大纲 | 图表」双视图切换（默认大纲，状态记忆于组件内 useState）：
 * 图表视图按 kind（图/表/式/算法）分组，小标题带计数徽标；条目显示 kind 图标字符 +
 * caption 截断 60 字 + 文件:行号，点击 jumpTo 跳转。
 * 样式：复用全局 sf-subtabs / sf-outline* / sf-chip / placeholder + 内联样式（不新增 css）。
 */

import { useMemo, useState } from 'react';
import { useT } from '../i18n';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { outlineAcrossFiles, resolveEntry } from '../projectDoc';
import { jumpTo } from '../editorJump';
import { scanFloats, type FloatItem, type FloatKind } from '../floatsScan';

// ---------------------------------------------------------------------------
// 双语文案（组件内字典：zh / en）
// ---------------------------------------------------------------------------

interface Dict {
  tabOutline: string;
  tabFloats: string;
  kindLabel: Record<FloatKind, string>;
  kindIcon: Record<FloatKind, string>;
  noFloats: string;
  noCaption: string;
}

const DICT: Record<Language, Dict> = {
  zh: {
    tabOutline: '大纲',
    tabFloats: '图表',
    kindLabel: { figure: '图', table: '表', equation: '式', algorithm: '算法' },
    kindIcon: { figure: '图', table: '表', equation: '式', algorithm: '算' },
    noFloats: '未发现图表（figure / table / equation / algorithm）',
    noCaption: '（无题注）',
  },
  en: {
    tabOutline: 'Outline',
    tabFloats: 'Floats',
    kindLabel: { figure: 'Figures', table: 'Tables', equation: 'Equations', algorithm: 'Algorithms' },
    kindIcon: { figure: 'Fig', table: 'Tbl', equation: 'Eq', algorithm: 'Alg' },
    noFloats: 'No floats found (figure / table / equation / algorithm)',
    noCaption: '(no caption)',
  },
};

/** 图表视图分组顺序：图 → 表 → 式 → 算法 */
const KIND_ORDER: FloatKind[] = ['figure', 'table', 'equation', 'algorithm'];

/** caption 展示截断上限 */
const CAPTION_MAX = 60;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 条目主文案：caption 截断 60 字，无 caption 回退 label，再回退占位 */
function floatTitle(item: FloatItem, noCaption: string): string {
  if (item.caption) return truncate(item.caption, CAPTION_MAX);
  if (item.label) return truncate(item.label, CAPTION_MAX);
  return noCaption;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export function OutlinePanel() {
  const t = useT();
  const lang = useSettingsStore((s) => s.language);
  const d = DICT[lang];
  const files = useWorkspaceStore((s) => s.files);
  const entry = resolveEntry(files);
  const items = useMemo(() => outlineAcrossFiles(files), [files]);
  const floats = useMemo(() => scanFloats(files), [files]);

  // 双视图切换：默认大纲；状态记忆于组件内（面板卸载后重置）
  const [view, setView] = useState<'outline' | 'floats'>('outline');

  const groups = useMemo(
    () =>
      KIND_ORDER.map((kind) => ({ kind, list: floats.filter((f) => f.kind === kind) })).filter(
        (g) => g.list.length > 0,
      ),
    [floats],
  );

  return (
    <div>
      <div className="sf-subtabs" role="tablist">
        <button
          role="tab"
          aria-selected={view === 'outline'}
          className={view === 'outline' ? 'active' : ''}
          onClick={() => setView('outline')}
        >
          {d.tabOutline}
        </button>
        <button
          role="tab"
          aria-selected={view === 'floats'}
          className={view === 'floats' ? 'active' : ''}
          onClick={() => setView('floats')}
        >
          {d.tabFloats}
        </button>
      </div>

      {view === 'outline' ? (
        items.length === 0 ? (
          <p className="placeholder">{t('outline.empty')}</p>
        ) : (
          <ul className="sf-outline">
            {items.map(({ file, node }, i) => (
              <li
                key={`${file}:${node.line}:${i}`}
                className="sf-outline-item"
                style={{ paddingLeft: 8 + Math.max(0, node.level - 1) * 12 }}
                onClick={() => jumpTo({ file, line: node.line })}
                title={`${file}:${node.line}`}
              >
                <span className="sf-outline-title">{node.title}</span>
                {file !== entry && <span className="sf-outline-file">{file}</span>}
              </li>
            ))}
          </ul>
        )
      ) : groups.length === 0 ? (
        <p className="placeholder">{d.noFloats}</p>
      ) : (
        <div>
          {groups.map(({ kind, list }) => (
            <section key={kind} className="sf-floats-group">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  margin: '8px 0 4px',
                  fontSize: 11,
                  color: 'var(--fg-2)',
                }}
              >
                <strong style={{ color: 'var(--fg-1)' }}>{d.kindLabel[kind]}</strong>
                <span className="sf-chip">{list.length}</span>
              </div>
              <ul className="sf-outline">
                {list.map((f, i) => (
                  <li
                    key={`${f.file}:${f.line}:${i}`}
                    className="sf-outline-item"
                    onClick={() => jumpTo({ file: f.file, line: f.line })}
                    title={f.label ? `${f.label} · ${f.file}:${f.line}` : `${f.file}:${f.line}`}
                  >
                    <span
                      style={{
                        flex: 'none',
                        fontSize: 10,
                        color: 'var(--accent)',
                        minWidth: 22,
                      }}
                    >
                      {d.kindIcon[f.kind]}
                    </span>
                    <span className="sf-outline-title">{floatTitle(f, d.noCaption)}</span>
                    <span className="sf-outline-file">
                      {f.file}:{f.line}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
