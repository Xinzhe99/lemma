/** 英文模板共用的 3 条示例文献 */
export const standardRefsBib = String.raw`@article{knuth1984literate,
  author  = {Knuth, Donald E.},
  title   = {Literate Programming},
  journal = {The Computer Journal},
  year    = {1984},
  volume  = {27},
  number  = {2},
  pages   = {97--111}
}

@book{lamport1994latex,
  author    = {Lamport, Leslie},
  title     = {LaTeX: A Document Preparation System},
  edition   = {2nd},
  publisher = {Addison-Wesley},
  address   = {Reading, Massachusetts},
  year      = {1994}
}

@inproceedings{greenwade1993ctan,
  author    = {Greenwade, George D.},
  title     = {The Comprehensive TeX Archive Network (CTAN)},
  booktitle = {TUGboat},
  volume    = {14},
  number    = {2},
  pages     = {142--146},
  year      = {1993}
}
`;

/** 中文模板专用的 3 条示例文献（GB/T 7714 观感的中文条目） */
export const chineseRefsBib = String.raw`@article{zhang2023survey,
  author  = {张三 and 李四},
  title   = {深度学习在科学计算中的应用综述},
  journal = {计算机学报},
  year    = {2023},
  volume  = {46},
  number  = {5},
  pages   = {1--25}
}

@book{wang2020method,
  author    = {王五},
  title     = {统计学习方法（第二版）},
  publisher = {清华大学出版社},
  address   = {北京},
  year      = {2020}
}

@inproceedings{liu2024assistant,
  author    = {刘六 and 赵七},
  title     = {大语言模型驱动的科研助手},
  booktitle = {第二十一届中国机器学习会议},
  year      = {2024},
  pages     = {112--120}
}
`;
