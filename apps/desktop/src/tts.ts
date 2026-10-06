/**
 * TTS 朗读校对（v6.7.0 F2）：Web Speech API（免费、本地、离线可用）。
 * 读出声能听到默读发现不了的问题：句子过长、语气断裂、重复用词。
 * - speak(text, lang)：朗读（取消之前的）；自动剥离 LaTeX 命令/注释/定界符，
 *   数学念原符号串（诚实），环境标记跳过
 * - pause()/resume()/stop()
 * - isSupported()：WebView2/WKWebView 均内置 speechSynthesis
 */

export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** LaTeX → 可朗读文本：剥命令保留参数、去注释、去定界符/环境 */
export function latexToSpeakable(latex: string): string {
  return latex
    .replace(/(?<!\\)%[^\n]*/g, ' ') // 注释
    .replace(/\\(begin|end)\{[^}]*\}/g, ' ') // 环境标记
    .replace(/\\(label|ref|cite|citep|citet|eqref|includegraphics|usepackage|documentclass|title|author|date)\*?(\[[^\]]*\])?\{[^}]*\}/g, ' ')
    .replace(/\\[a-zA-Z]+\*?/g, ' ') // 其余命令
    .replace(/[{}]/g, ' ')
    .replace(/[$~]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

// v6.9.0：Chromium（含 WebView2）已知 bug——长 utterance 播放约 15s 后静默停摆；
// 保活定时器周期性 resume() 让引擎继续（对未暂停状态是无害 no-op）
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

function startKeepAlive(): void {
  stopKeepAlive();
  keepAliveTimer = setInterval(() => {
    const synth = window.speechSynthesis;
    if (!synth.speaking) {
      stopKeepAlive();
      return;
    }
    if (!synth.paused) synth.resume();
  }, 10000);
}

function stopKeepAlive(): void {
  if (keepAliveTimer !== null) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

export function speak(text: string, lang: 'zh' | 'en' = 'zh'): boolean {
  if (!ttsSupported()) return false;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang === 'zh' ? 'zh-CN' : 'en-US';
  utter.rate = 1.0;
  utter.onend = () => stopKeepAlive();
  utter.onerror = () => stopKeepAlive();
  window.speechSynthesis.speak(utter);
  startKeepAlive();
  return true;
}

export function pauseTts(): void {
  if (ttsSupported()) window.speechSynthesis.pause();
}

export function resumeTts(): void {
  if (ttsSupported()) window.speechSynthesis.resume();
}

export function stopTts(): void {
  if (ttsSupported()) {
    stopKeepAlive();
    window.speechSynthesis.cancel();
  }
}

export function isSpeaking(): boolean {
  return ttsSupported() && window.speechSynthesis.speaking;
}
