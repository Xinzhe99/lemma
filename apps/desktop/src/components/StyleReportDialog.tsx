/**
 * 风格分析报告对话框（v1.3.0；LazyFeatureDialog 契约：export StyleReportDialog({ onClose })）：
 * 对当前打开的 .tex（缺省回落到工作区任一 .tex）跑 analyzeStyle——
 *  - 概览指标卡：句数 / 平均句长 / P95 句长 / 被动语态占比 / FK 年级（目标 12–18 着色）；
 *  - 长句清单（>35 词，前 12 条，点击跳源码行）；
 *  - 被动语态命中（前 12 条，点击跳）；
 *  - 模糊限定词计数 chips；
 *  - 段落统计（超长段落 >150 词清单）。
 * 点击跳转经 editorJump.jumpTo（编辑器未挂载时其内部兜底打开文件）。
 * 纯前端零依赖计算（useMemo，文件内容变化才重算）；zh/en 组件内字典。
 */

import { useEffect, useMemo, useState } from 'react';
import {
  analyzeStyle,
  FK_TARGET_RANGE,
  analyzeWordFrequency,
  LONG_PARAGRAPH_WORDS,
  LONG_SENTENCE_WORDS,
} from '@lemma/editor';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { jumpTo } from '../editorJump';

const STRINGS = {
  zh: {
    title: '风格分析报告',
    pickFile: '分析文件',
    noTex: '项目中没有 .tex 文件',
    emptyDoc: '该文件没有可分析的正文',
    sentences: '句子',
    words: '词',
    avgLen: '平均句长',
    p95Len: 'P95 句长',
    passive: '被动语态',
    fkGrade: '可读性（FK 年级）',
    fkHint: (lo: number, hi: number) => `学术惯例目标 ${lo}–${hi}`,
    fkLow: '偏易（可能口语化）',
    fkHigh: '偏难（长句/长词密集）',
    fkOk: '在目标区间',
    longSentences: (n: number) => `长句（>${LONG_SENTENCE_WORDS} 词，前 ${n} 条）`,
    longEmpty: '没有超长句，节奏良好',
    passiveHits: (n: number) => `被动语态命中（前 ${n} 条）`,
    passiveEmpty: '未检出被动语态',
    weasel: '模糊限定词',
    weaselEmpty: '未检出模糊限定词',
    paragraphs: (n: number) => `段落 ${n} 个`,
    longParas: (n: number) => `超长段落（>${LONG_PARAGRAPH_WORDS} 词，前 ${n} 条）`,
    longParasEmpty: '段落长度均衡',
    jump: '跳转',
    wordsUnit: '词',
    close: '关闭',
    note: '启发式分析：被动语态与音节计数为近似值，供改稿参考而非硬性规则。',
  },
  en: {
    title: 'Style report',
    pickFile: 'File',
    noTex: 'No .tex file in this project',
    emptyDoc: 'No analyzable prose in this file',
    sentences: 'Sentences',
    words: 'Words',
    avgLen: 'Avg sentence',
    p95Len: 'P95 sentence',
    passive: 'Passive voice',
    fkGrade: 'Readability (FK grade)',
    fkHint: (lo: number, hi: number) => `Academic target ${lo}–${hi}`,
    fkLow: 'Easy (maybe colloquial)',
    fkHigh: 'Dense (long sentences/words)',
    fkOk: 'In target range',
    longSentences: (n: number) => `Long sentences (>${LONG_SENTENCE_WORDS} words, top ${n})`,
    longEmpty: 'No oversized sentences — good rhythm',
    passiveHits: (n: number) => `Passive voice hits (top ${n})`,
    passiveEmpty: 'No passive voice detected',
    weasel: 'Weasel words',
    weaselEmpty: 'No weasel words detected',
    paragraphs: (n: number) => `${n} paragraphs`,
    longParas: (n: number) => `Oversized paragraphs (>${LONG_PARAGRAPH_WORDS} words, top ${n})`,
    longParasEmpty: 'Paragraph lengths look balanced',
    jump: 'Jump',
    wordsUnit: 'words',
    close: 'Close',
    note: 'Heuristic analysis: passive-voice and syllable counts are approximations — editing hints, not rules.',
  },
} as const;

function MetricCard({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'err' }) {
  return (
    <div style={{ minWidth: 96 }}>
      <div style={{ fontSize: 11, color: 'var(--fg-2)' }}>{label}</div>
      <div
        style={{
          fontSize: 19,
          fontWeight: 600,
          fontFamily: 'monospace',
          color: tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : tone === 'err' ? 'var(--err)' : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}

export function StyleReportDialog({ onClose }: { onClose: () => void }) {
  const language = useSettingsStore((s) => s.language);
  const L = STRINGS[language] as (typeof STRINGS)[Language];

  const files = useWorkspaceStore((s) => s.files);
  const activeTab = useWorkspaceStore((s) => s.activeTab);
  const texFiles = useMemo(() => Object.keys(files).filter((f) => f.endsWith('.tex')).sort(), [files]);
  const [file, setFile] = useState(activeTab && activeTab.endsWith('.tex') ? activeTab : (texFiles[0] ?? ''));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const report = useMemo(() => (file ? analyzeStyle(files[file] ?? '') : null), [file, files]);
  const wordFreq = useMemo(
    () => (file ? analyzeWordFrequency(files[file] ?? '') : null),
    [file, files],
  );

  const fkTone: 'ok' | 'warn' | undefined =
    report == null || report.sentences === 0
      ? undefined
      : report.fkGrade < FK_TARGET_RANGE[0]
        ? 'warn'
        : report.fkGrade > FK_TARGET_RANGE[1]
          ? 'warn'
          : 'ok';
  const fkNote =
    report == null || report.sentences === 0
      ? ''
      : report.fkGrade < FK_TARGET_RANGE[0]
        ? L.fkLow
        : report.fkGrade > FK_TARGET_RANGE[1]
          ? L.fkHigh
          : L.fkOk;

  const goto = (line?: number): void => {
    if (!file || line == null) return;
    jumpTo({ file, line });
    onClose();
  };

  return (
    <div className="sf-dialog-overlay" onMouseDown={onClose}>
      <div className="sf-dialog" style={{ minWidth: 520 }} onMouseDown={(e) => e.stopPropagation()}>
        <header className="sf-dialog-header">
          <strong>{L.title}</strong>
          {texFiles.length > 0 && (
            <select className="sf-input" style={{ width: 200 }} value={file} onChange={(e) => setFile(e.target.value)}>
              {texFiles.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          )}
        </header>
        <div className="sf-dialog-body">
          {texFiles.length === 0 ? (
            <p style={{ color: 'var(--fg-2)' }}>{L.noTex}</p>
          ) : report == null || report.sentences === 0 ? (
            <p style={{ color: 'var(--fg-2)' }}>{L.emptyDoc}</p>
          ) : (
            <>
              <section style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <MetricCard label={L.sentences} value={String(report.sentences)} />
                <MetricCard label={L.words} value={String(report.words)} />
                <MetricCard label={L.avgLen} value={`${report.avgSentenceWords}`} />
                <MetricCard
                  label={L.p95Len}
                  value={String(report.p95SentenceWords)}
                  tone={report.p95SentenceWords > LONG_SENTENCE_WORDS ? 'warn' : 'ok'}
                />
                <MetricCard label={L.passive} value={`${report.passivePct}%`} tone={report.passivePct > 25 ? 'warn' : undefined} />
                <MetricCard label={L.fkGrade} value={String(report.fkGrade)} tone={fkTone} />
              </section>
              {fkNote && (
                <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--fg-2)' }}>
                  {L.fkGrade} · {fkNote}（{L.fkHint(FK_TARGET_RANGE[0], FK_TARGET_RANGE[1])}）
                </p>
              )}

              <section style={{ marginTop: 14 }}>
                <strong style={{ fontSize: 12.5 }}>{L.longSentences(report.longSentences.length)}</strong>
                {report.longSentences.length === 0 ? (
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ok)' }}>{L.longEmpty}</p>
                ) : (
                  <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'grid', gap: 6 }}>
                    {report.longSentences.map((s, i) => (
                      <li
                        key={i}
                        className="sf-todo-row"
                        style={{ display: 'flex', gap: 8, alignItems: 'baseline', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}
                      >
                        <span className="sf-chip warn">{s.words} {L.wordsUnit}</span>
                        <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.text}
                        </span>
                        {s.line != null && (
                          <button className="sf-link-btn" onClick={() => goto(s.line)}>
                            {L.jump}:{s.line}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section style={{ marginTop: 14 }}>
                <strong style={{ fontSize: 12.5 }}>{L.passiveHits(report.passiveHits.length)}</strong>
                {report.passiveHits.length === 0 ? (
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ok)' }}>{L.passiveEmpty}</p>
                ) : (
                  <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'grid', gap: 4 }}>
                    {report.passiveHits.map((h, i) => (
                      <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                        <code style={{ fontSize: 12 }}>{h.text}</code>
                        {h.line != null && (
                          <button className="sf-link-btn" onClick={() => goto(h.line)}>
                            {h.line}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section style={{ marginTop: 14 }}>
                <strong style={{ fontSize: 12.5 }}>{L.weasel}</strong>
                {report.weaselCounts.length === 0 ? (
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ok)' }}>{L.weaselEmpty}</p>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {report.weaselCounts.map((w) => (
                      <span key={w.word} className="sf-chip dim">
                        {w.word} ×{w.count}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              <section style={{ marginTop: 14 }}>
                <strong style={{ fontSize: 12.5 }}>{L.paragraphs(report.paragraphs)}</strong>
                {report.longParagraphs.length === 0 ? (
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ok)' }}>{L.longParasEmpty}</p>
                ) : (
                  <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'grid', gap: 4 }}>
                    {report.longParagraphs.map((p, i) => (
                      <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                        <span className="sf-chip warn">{p.words} {L.wordsUnit}</span>
                        {p.line != null && (
                          <button className="sf-link-btn" onClick={() => goto(p.line)}>
                            {L.jump}:{p.line}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--fg-2)' }}>{L.longParas(report.longParagraphs.length)}</p>
              </section>

              <p style={{ margin: '14px 0 0', fontSize: 11, color: 'var(--fg-2)' }}>{L.note}</p>

              {wordFreq && wordFreq.topWords.length > 0 && (
                <section style={{ marginTop: 14 }}>
                  <strong style={{ fontSize: 12.5 }}>词汇使用（前 {wordFreq.topWords.length} 个高频词）</strong>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {wordFreq.topWords.map((w) => (
                      <span key={w.word} className="sf-chip dim" title={w.word + ': ' + w.count + ' 次'}>
                        {w.word} ×{w.count}
                      </span>
                    ))}
                  </div>
                  {wordFreq.repeatedPhrases.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <span style={{ fontSize: 11.5, color: 'var(--fg-2)' }}>重复短语：</span>
                      {wordFreq.repeatedPhrases.map((ph) => (
                        <span key={ph.phrase} className="sf-chip warn" style={{ marginLeft: 4 }} title={ph.phrase + ': ' + ph.count + ' 次'}>
                          "{ph.phrase}" ×{ph.count}
                        </span>
                      ))}
                    </div>
                  )}
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--fg-2)' }}>
                    词汇丰富度：{wordFreq.uniqueWords} 个不同词 / 共 {wordFreq.totalWords} 词
                  </p>
                </section>
              )}
            </>
          )}
        </div>
        <footer className="sf-lib-dialog-actions" style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="sf-btn dim" onClick={onClose}>
            {L.close}
          </button>
        </footer>
      </div>
    </div>
  );
}
