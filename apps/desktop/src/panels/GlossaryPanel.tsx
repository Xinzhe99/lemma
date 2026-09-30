/**
 * 术语面板：从项目全文抽取术语表（缩写定义）+ 一致性检查（定义前使用/重复定义/冗余全称）。
 * 知识底座 4.7 的术语锁定能力在 UI 的落点。
 */

import { useMemo } from 'react';
import { extractGlossary, checkConsistency } from '@scholarforge/knowledge';
import { useWorkspaceStore } from '../state/workspaceStore';
import { combinedDoc } from '../projectDoc';

export function GlossaryPanel() {
  const files = useWorkspaceStore((s) => s.files);
  const doc = useMemo(() => combinedDoc(files), [files]);
  const glossary = useMemo(() => extractGlossary(doc), [doc]);
  const issues = useMemo(() => (doc.trim() ? checkConsistency(doc, glossary) : []), [doc, glossary]);

  return (
    <div className="sf-glossary">
      <p className="sf-lib-count">
        术语 {glossary.length} 条 · 一致性问题 {issues.filter((i) => i.severity === 'error').length} 处
      </p>
      {glossary.length === 0 ? (
        <p className="placeholder">
          未识别到缩写定义。在正文中使用「Full Capitalized Term (FCT)」形式书写即可自动收录。
        </p>
      ) : (
        <ul className="sf-glossary-list">
          {glossary.map((g) => (
            <li key={g.id} className="sf-glossary-row">
              <div className="sf-glossary-main">
                <span className="sf-glossary-term">{g.term}</span>
                {g.abbr && <code className="sf-glossary-abbr">{g.abbr}</code>}
              </div>
              {g.translation && <span className="sf-glossary-trans">译名：{g.translation}</span>}
            </li>
          ))}
        </ul>
      )}
      {issues.length > 0 && (
        <div className="sf-glossary-issues">
          <div className="sf-agent-wf-title">一致性检查</div>
          <ul>
            {issues.map((issue, i) => (
              <li
                key={i}
                className={`sf-glossary-issue ${issue.severity === 'error' ? 'sf-glossary-issue--error' : ''}`}
              >
                {issue.abbr && <span className="sf-chip dim">{issue.abbr}</span>} {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
