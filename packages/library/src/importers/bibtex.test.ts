import { describe, expect, it } from 'vitest';
import { parseBibtex, parseBibtexAuthors, parsePersonName } from './bibtex';

const BIB = `
前言垃圾文本，不是条目。

@string{cvpr = {IEEE Conference on Computer Vision and Pattern Recognition}}

@inproceedings{hinton2012imagenet,
  author = {Hinton, Geoffrey E. and Krizhevsky, Alex and Sutskever, Ilya and Salakhutdinov, Ruslan},
  title = {ImageNet Classification with Deep {Convolutional} Neural Networks},
  booktitle = {Advances in Neural Information Processing Systems},
  year = {2012},
  pages = {1097--1105}
}

@article{he2016deep,
  author = "He, {Kaiming} and Zhang, Xiangyu and Ren, Shaoqing and Sun, Jian",
  title = "Deep " # cvpr # " Learning for Image Recognition",
  journal = cvpr,
  year = 2016,
  doi = {https://doi.org/10.1109/CVPR.2016.90}
}

@misc{no_title_here, author = {Nobody}, year = {2020} }

@inproceedings{,
  title = {No Key}
}

@book{unterminated,
  title = {Oops
`;

describe('parseBibtex', () => {
  const { papers, errors } = parseBibtex(BIB);

  it('正常条目被解析，坏条目进 errors 且不中断', () => {
    expect(papers.map(p => p.citekey)).toEqual(['hinton2012imagenet', 'he2016deep']);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain('no_title_here');
    expect(errors[1]).toContain('citekey');
    expect(errors[2]).toContain('unterminated');
  });

  it('inproceedings：字段映射与嵌套大括号保留', () => {
    const hinton = papers[0]!;
    expect(hinton.title).toBe('ImageNet Classification with Deep {Convolutional} Neural Networks');
    expect(hinton.year).toBe(2012);
    expect(hinton.venue?.type).toBe('conference');
    expect(hinton.venue?.name).toBe('Advances in Neural Information Processing Systems');
    expect(hinton.venue?.pages).toBe('1097--1105');
    expect(hinton.readStatus).toBe('to-read');
  });

  it('author "Family, Given and ..." 解析为 PaperAuthor[]', () => {
    const hinton = papers[0]!;
    expect(hinton.authors).toEqual([
      { family: 'Hinton', given: 'Geoffrey E.' },
      { family: 'Krizhevsky', given: 'Alex' },
      { family: 'Sutskever', given: 'Ilya' },
      { family: 'Salakhutdinov', given: 'Ruslan' },
    ]);
  });

  it('引号值、# 拼接、@string 常量展开、DOI 归一化、作者保护性大括号剥离', () => {
    const he = papers[1]!;
    expect(he.title).toBe(
      'Deep IEEE Conference on Computer Vision and Pattern Recognition Learning for Image Recognition',
    );
    expect(he.venue?.name).toBe('IEEE Conference on Computer Vision and Pattern Recognition');
    expect(he.venue?.type).toBe('journal');
    expect(he.year).toBe(2016);
    expect(he.doi).toBe('10.1109/cvpr.2016.90');
    expect(he.authors[0]).toEqual({ family: 'He', given: 'Kaiming' });
    expect(he.authors).toHaveLength(4);
  });
});

describe('parseBibtex 行注释（%）', () => {
  it('条目内的 “%” 行注释不会让其后字段被丢弃', () => {
    const { papers: parsed, errors } = parseBibtex(
      [
        '@article{commented,',
        '  title = {A Title}, % 题注：这是行注释',
        '  % 整行注释：年份如下',
        '  year = {2020},',
        '  journal = {J}',
        '}',
      ].join('\n'),
    );
    expect(errors).toEqual([]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.title).toBe('A Title');
    expect(parsed[0]!.year).toBe(2020);
    expect(parsed[0]!.venue?.name).toBe('J');
  });
});

describe('parseBibtexAuthors / parsePersonName', () => {
  it('非逗号形式：末词为 family', () => {
    expect(parseBibtexAuthors('Ashish Vaswani and Noam Shazeer')).toEqual([
      { family: 'Vaswani', given: 'Ashish' },
      { family: 'Shazeer', given: 'Noam' },
    ]);
  });

  it('大括号保护的公司名中的 and 不切分；others 被忽略', () => {
    const authors = parseBibtexAuthors('{Barnes and Noble} and Smith, John and others');
    expect(authors).toEqual([
      { family: 'Barnes and Noble' },
      { family: 'Smith', given: 'John' },
    ]);
  });

  it('parsePersonName 处理空串与 others', () => {
    expect(parsePersonName('')).toBeNull();
    expect(parsePersonName('  others  ')).toBeNull();
    expect(parsePersonName('  Deng  ')).toEqual({ family: 'Deng' });
  });
});
