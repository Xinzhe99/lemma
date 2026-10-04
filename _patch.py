import sys

p = 'apps/desktop/src/components/StyleReportDialog.tsx'
src = open(p, encoding='utf-8').read()

# 1) import
old = "import { jumpTo } from '../editorJump';"
assert old in src, 'import anchor'
src = src.replace(old, old + "\nimport { analyzeWordFrequency } from '@lemma/editor';", 1)

# 2) add wordFreq memo
old2 = "  const report = useMemo(() => (file ? analyzeStyle(files[file] ?? '') : null), [file, files]);"
assert old2 in src, 'report memo anchor'
src = src.replace(
    old2,
    old2 + "\n  const wordFreq = useMemo(() => (file ? analyzeWordFrequency(files[file] ?? '') : null), [file, files]);",
    1,
)

# 3) add rendering after the note paragraph
old3 = "                <p style={{ margin: '0 0 0', fontSize: 11, color: 'var(--fg-2)' }}>{L.note}</p>"
assert old3 in src, 'note paragraph anchor'

new_section = """                <p style={{ margin: '0 0 0', fontSize: 11, color: 'var(--fg-2)' }}>{L.note}</p>

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
              )}"""

src = src.replace(old3, new_section, 1)

open(p, 'w', encoding='utf-8', newline='').write(src)
print('styleReport patched')
