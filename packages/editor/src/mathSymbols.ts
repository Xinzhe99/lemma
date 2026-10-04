/**
 * 数学符号面板数据（v3.3.0 ①）：分类展示常用数学符号。
 */

export interface SymbolItem {
  latex: string;
  display: string;
  name: string;
}

export type SymbolCategory =
  | 'greek-lower' | 'greek-upper' | 'operators' | 'relations'
  | 'arrows' | 'delimiters' | 'big-ops' | 'misc' | 'templates';

export const CATEGORY_LABELS: Record<SymbolCategory, { zh: string; en: string }> = {
  'greek-lower': { zh: '希腊小写', en: 'Greek lowercase' },
  'greek-upper': { zh: '希腊大写', en: 'Greek uppercase' },
  operators: { zh: '二元运算', en: 'Binary operators' },
  relations: { zh: '关系符号', en: 'Relations' },
  arrows: { zh: '箭头', en: 'Arrows' },
  delimiters: { zh: '定界符', en: 'Delimiters' },
  'big-ops': { zh: '大运算符', en: 'Big operators' },
  misc: { zh: '杂项', en: 'Misc' },
  templates: { zh: '模板', en: 'Templates' },
};

export const MATH_SYMBOLS: Record<SymbolCategory, SymbolItem[]> = {
  'greek-lower': [
    { latex: '\\alpha', display: 'α', name: 'alpha' },
    { latex: '\\beta', display: 'β', name: 'beta' },
    { latex: '\\gamma', display: 'γ', name: 'gamma' },
    { latex: '\\delta', display: 'δ', name: 'delta' },
    { latex: '\\epsilon', display: 'ε', name: 'epsilon' },
    { latex: '\\zeta', display: 'ζ', name: 'zeta' },
    { latex: '\\eta', display: 'η', name: 'eta' },
    { latex: '\\theta', display: 'θ', name: 'theta' },
    { latex: '\\lambda', display: 'λ', name: 'lambda' },
    { latex: '\\mu', display: 'μ', name: 'mu' },
    { latex: '\\pi', display: 'π', name: 'pi' },
    { latex: '\\rho', display: 'ρ', name: 'rho' },
    { latex: '\\sigma', display: 'σ', name: 'sigma' },
    { latex: '\\tau', display: 'τ', name: 'tau' },
    { latex: '\\phi', display: 'φ', name: 'phi' },
    { latex: '\\psi', display: 'ψ', name: 'psi' },
    { latex: '\\omega', display: 'ω', name: 'omega' },
  ],
  'greek-upper': [
    { latex: '\\Gamma', display: 'Γ', name: 'Gamma' },
    { latex: '\\Delta', display: 'Δ', name: 'Delta' },
    { latex: '\\Theta', display: 'Θ', name: 'Theta' },
    { latex: '\\Lambda', display: 'Λ', name: 'Lambda' },
    { latex: '\\Pi', display: 'Π', name: 'Pi' },
    { latex: '\\Sigma', display: 'Σ', name: 'Sigma' },
    { latex: '\\Phi', display: 'Φ', name: 'Phi' },
    { latex: '\\Psi', display: 'Ψ', name: 'Psi' },
    { latex: '\\Omega', display: 'Ω', name: 'Omega' },
  ],
  operators: [
    { latex: '\\pm', display: '±', name: 'plus minus' },
    { latex: '\\times', display: '×', name: 'times' },
    { latex: '\\div', display: '÷', name: 'divide' },
    { latex: '\\cdot', display: '·', name: 'dot' },
    { latex: '\\oplus', display: '⊕', name: 'circled plus' },
    { latex: '\\otimes', display: '⊗', name: 'circled times' },
    { latex: '\\wedge', display: '∧', name: 'and' },
    { latex: '\\vee', display: '∨', name: 'or' },
    { latex: '\\setminus', display: '∖', name: 'set minus' },
  ],
  relations: [
    { latex: '\\leq', display: '≤', name: 'less or equal' },
    { latex: '\\geq', display: '≥', name: 'greater or equal' },
    { latex: '\\neq', display: '≠', name: 'not equal' },
    { latex: '\\approx', display: '≈', name: 'approx' },
    { latex: '\\equiv', display: '≡', name: 'equivalent' },
    { latex: '\\sim', display: '∼', name: 'similar' },
    { latex: '\\subset', display: '⊂', name: 'subset' },
    { latex: '\\subseteq', display: '⊆', name: 'subset eq' },
    { latex: '\\supset', display: '⊃', name: 'superset' },
    { latex: '\\in', display: '∈', name: 'element' },
    { latex: '\\notin', display: '∉', name: 'not in' },
    { latex: '\\prec', display: '≺', name: 'precedes' },
    { latex: '\\lesssim', display: '≲', name: 'less or sim' },
    { latex: '\\gtrsim', display: '≳', name: 'greater or sim' },
  ],
  arrows: [
    { latex: '\\rightarrow', display: '→', name: 'right' },
    { latex: '\\leftarrow', display: '←', name: 'left' },
    { latex: '\\Rightarrow', display: '⇒', name: 'implies' },
    { latex: '\\Leftarrow', display: '⇐', name: 'implied by' },
    { latex: '\\Leftrightarrow', display: '⇔', name: 'iff' },
    { latex: '\\mapsto', display: '↦', name: 'maps to' },
    { latex: '\\to', display: '→', name: 'to' },
  ],
  delimiters: [
    { latex: '\\lfloor', display: '⌊', name: 'left floor' },
    { latex: '\\rfloor', display: '⌋', name: 'right floor' },
    { latex: '\\lceil', display: '⌈', name: 'left ceil' },
    { latex: '\\rceil', display: '⌉', name: 'right ceil' },
    { latex: '\\langle', display: '⟨', name: 'left angle' },
    { latex: '\\rangle', display: '⟩', name: 'right angle' },
    { latex: '\\|', display: '‖', name: 'norm' },
  ],
  'big-ops': [
    { latex: '\\sum', display: '∑', name: 'sum' },
    { latex: '\\prod', display: '∏', name: 'product' },
    { latex: '\\int', display: '∫', name: 'integral' },
    { latex: '\\bigcup', display: '⋃', name: 'big union' },
    { latex: '\\bigcap', display: '⋂', name: 'big intersection' },
    { latex: '\\bigoplus', display: '⨁', name: 'big oplus' },
    { latex: '\\bigotimes', display: '⨂', name: 'big otimes' },
  ],
  misc: [
    { latex: '\\infty', display: '∞', name: 'infinity' },
    { latex: '\\partial', display: '∂', name: 'partial' },
    { latex: '\\nabla', display: '∇', name: 'nabla' },
    { latex: '\\forall', display: '∀', name: 'for all' },
    { latex: '\\exists', display: '∃', name: 'exists' },
    { latex: '\\neg', display: '¬', name: 'negation' },
    { latex: '\\emptyset', display: '∅', name: 'empty set' },
    { latex: '\\hbar', display: 'ℏ', name: 'hbar' },
    { latex: '\\ell', display: 'ℓ', name: 'ell' },
    { latex: '\\degree', display: '°', name: 'degree' },
  ],
  templates: [
    { latex: '\\frac{a}{b}', display: 'a/b', name: 'fraction' },
    { latex: '\\sqrt{x}', display: '√x', name: 'sqrt' },
    { latex: 'x^{n}', display: 'xⁿ', name: 'superscript' },
    { latex: 'x_{i}', display: 'xᵢ', name: 'subscript' },
    { latex: '\\mathbb{R}', display: 'ℝ', name: 'real numbers' },
    { latex: '\\hat{x}', display: 'x̂', name: 'hat' },
    { latex: '\\tilde{x}', display: 'x̃', name: 'tilde' },
    { latex: '\\bar{x}', display: 'x̄', name: 'bar' },
    { latex: '\\vec{x}', display: 'x⃗', name: 'vector' },
    { latex: '\\sum_{i=1}^{n}', display: '∑ᵢ₌₁ⁿ', name: 'sum limits' },
    { latex: '\\lim_{n\\to\\infty}', display: 'lim', name: 'limit' },
    { latex: '\\arg\\max_{x}', display: 'argmax', name: 'arg max' },
  ],
};
