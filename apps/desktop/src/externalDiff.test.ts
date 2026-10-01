/**
 * matchExternalFiles 纯函数详测：同名精确 / basename / 归一化（小写、去连字符）/
 * 大小写差异 / 多文件混合三态 / 空输入 / 一对一贪婪确定性。
 */
import { describe, expect, it } from 'vitest';
import { basenameOf, matchExternalFiles, normalizeFileName } from './externalDiff';

describe('matchExternalFiles（三级匹配三态清单）', () => {
  it('同名精确匹配为 matched，外部携带 external 键', () => {
    const out = matchExternalFiles({ 'main.tex': '导师版' }, { 'main.tex': '我的版', 'refs.bib': 'x' });
    expect(out).toEqual([
      { file: 'main.tex', status: 'matched', external: 'main.tex' },
      { file: 'refs.bib', status: 'only-local' },
    ]);
  });

  it('目录前缀差异走 basename 匹配：导师去掉/加了目录都能对上', () => {
    const out = matchExternalFiles(
      { 'intro.tex': '导师版' }, // 导师去掉 sections/ 前缀
      { 'sections/intro.tex': '我的版' },
    );
    expect(out).toEqual([{ file: 'sections/intro.tex', status: 'matched', external: 'intro.tex' }]);

    const rev = matchExternalFiles(
      { 'sections/intro.tex': '导师版' }, // 导师加了前缀
      { 'intro.tex': '我的版' },
    );
    expect(rev).toEqual([{ file: 'intro.tex', status: 'matched', external: 'sections/intro.tex' }]);
  });

  it('大小写差异：basename 不等（Intro ≠ intro）时由归一化层级兜底', () => {
    const out = matchExternalFiles({ 'Sections/Intro.tex': '导师版' }, { 'sections/intro.tex': '我的版' });
    expect(out).toEqual([
      { file: 'sections/intro.tex', status: 'matched', external: 'Sections/Intro.tex' },
    ]);
  });

  it('连字符差异归一化匹配：my-file.tex ↔ My-File.tex / myfile 风格', () => {
    expect(matchExternalFiles({ 'My-File.tex': 'a' }, { 'my-file.tex': 'b' })[0]!.status).toBe('matched');
    expect(matchExternalFiles({ 'relatedwork.tex': 'a' }, { 'related-work.tex': 'b' })[0]!.status).toBe(
      'matched',
    );
  });

  it('扩展名不同不算匹配（intro.tex ≠ intro.bak），落为两态', () => {
    const out = matchExternalFiles({ 'intro.bak': 'a' }, { 'intro.tex': 'b' });
    expect(out).toEqual([
      { file: 'intro.bak', status: 'only-external' },
      { file: 'intro.tex', status: 'only-local' },
    ]);
  });

  it('多文件混合：三态齐备且 matched 按本地插入序分组返回', () => {
    const external = {
      'main.tex': 'm', // 精确
      'method.tex': 'm2', // basename 命中 sections/method.tex
      'advisor-notes.tex': 'm3', // 仅外部
    };
    const local = {
      'sections/method.tex': 'x',
      'main.tex': 'y',
      'refs.bib': 'z', // 仅本地
    };
    const out = matchExternalFiles(external, local);
    expect(out).toEqual([
      { file: 'sections/method.tex', status: 'matched', external: 'method.tex' },
      { file: 'main.tex', status: 'matched', external: 'main.tex' },
      { file: 'advisor-notes.tex', status: 'only-external' },
      { file: 'refs.bib', status: 'only-local' },
    ]);
  });

  it('一对一贪婪：两个本地同名 basename 只与先插入者匹配，另一个保持 only-local', () => {
    const out = matchExternalFiles(
      { 'intro.tex': '导师版' },
      { 'a/intro.tex': 'x', 'b/intro.tex': 'y' },
    );
    expect(out).toEqual([
      { file: 'a/intro.tex', status: 'matched', external: 'intro.tex' },
      { file: 'b/intro.tex', status: 'only-local' },
    ]);
  });

  it('仅外部（工作区为空全部 only-external）与仅本地（外部为空全部 only-local）', () => {
    expect(matchExternalFiles({ 'new.tex': 'a' }, {})).toEqual([
      { file: 'new.tex', status: 'only-external' },
    ]);
    expect(matchExternalFiles({}, { 'main.tex': 'a' })).toEqual([
      { file: 'main.tex', status: 'only-local' },
    ]);
  });

  it('双空返回空数组；不修改入参', () => {
    const external = { 'main.tex': 'a' };
    const local = { 'main.tex': 'b' };
    expect(matchExternalFiles({}, {})).toEqual([]);
    matchExternalFiles(external, local);
    expect(external).toEqual({ 'main.tex': 'a' });
    expect(local).toEqual({ 'main.tex': 'b' });
  });

  it('basenameOf 容忍反斜杠分隔（Windows 压缩包常见）', () => {
    expect(basenameOf('sections\\intro.tex')).toBe('intro.tex');
    expect(basenameOf('main.tex')).toBe('main.tex');
    expect(normalizeFileName('My-Related-Work.tex')).toBe('myrelatedwork.tex');
  });
});
