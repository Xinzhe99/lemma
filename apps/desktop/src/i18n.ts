/**
 * 极简 i18n：字典 + t(key, lang)。en 缺键回退 zh；两语皆缺返回 key 本身。
 */

import { useSettingsStore, type Language } from './state/settingsStore';

type Entry = { zh: string; en?: string };

const dict: Record<string, Entry> = {
  // 顶栏与命令面板
  'palette.trigger': { zh: '命令面板', en: 'Command palette' },
  'palette.placeholder': { zh: '输入命令…', en: 'Type a command…' },
  'palette.empty': { zh: '无匹配命令', en: 'No matching commands' },
  'compile.idle': { zh: '编译 · 未运行', en: 'Compile · idle' },
  'compile.running': { zh: '编译 · 运行中…', en: 'Compile · running…' },
  'compile.ok': { zh: '编译 · 成功', en: 'Compile · ok' },
  'compile.fail': { zh: '编译 · 失败', en: 'Compile · failed' },

  // 导航栏与侧栏
  'nav.outline': { zh: '大纲', en: 'Outline' },
  'nav.files': { zh: '文件', en: 'Files' },
  'nav.citations': { zh: '引用', en: 'Citations' },
  'nav.library': { zh: '文献库', en: 'Library' },
  'nav.reading': { zh: '文献阅读', en: 'Reading' },
  'placeholder.wsac': { zh: '待 WS-A/C 集成', en: 'Pending WS-A/C integration' },

  // 文件树
  'tree.newFile': { zh: '新建文件', en: 'New file' },
  'tree.rename': { zh: '重命名', en: 'Rename' },
  'tree.delete': { zh: '删除', en: 'Delete' },
  'tree.newFilePrompt': { zh: '新建文件路径（如 sections/notes.tex）', en: 'New file path (e.g. sections/notes.tex)' },
  'tree.renamePrompt': { zh: '重命名为', en: 'Rename to' },
  'tree.deleteConfirm': { zh: '确认删除', en: 'Confirm delete' },

  // 编辑区
  'editor.pending': { zh: '编辑器接入中（WS-A 集成待办）', en: 'Editor pending (WS-A integration)' },
  'editor.noOpen': { zh: '未打开文件', en: 'No file open' },

  // 编译控制台
  'console.title': { zh: '编译输出', en: 'Compile output' },
  'console.clear': { zh: '清空', en: 'Clear' },
  'console.pending': { zh: '编译服务接入中（WS-B 集成待办）', en: 'Compile service pending (WS-B integration)' },

  // Agent 面板
  'agent.title': { zh: 'Agent 面板', en: 'Agent panel' },
  'agent.pending': { zh: 'WS-D 集成待办', en: 'Pending WS-D integration' },
  'agent.provider': { zh: '当前模型服务', en: 'Active provider' },
  'agent.noProvider': { zh: '未配置', en: 'None configured' },

  // 设置对话框
  'settings.title': { zh: '设置', en: 'Settings' },
  'settings.tab.providers': { zh: '模型服务', en: 'Providers' },
  'settings.tab.appearance': { zh: '外观', en: 'Appearance' },
  'settings.tab.about': { zh: '关于', en: 'About' },
  'settings.addProvider': { zh: '新增服务', en: 'Add provider' },
  'settings.empty': { zh: '尚无模型服务，请新增。', en: 'No providers yet.' },
  'settings.field.label': { zh: '名称', en: 'Label' },
  'settings.field.baseUrl': { zh: '接口地址', en: 'Base URL' },
  'settings.field.apiKey': { zh: 'API 密钥', en: 'API key' },
  'settings.field.model': { zh: '模型', en: 'Model' },
  'settings.field.tier': { zh: '档位', en: 'Tier' },
  'settings.tier.cheap': { zh: '经济', en: 'Cheap' },
  'settings.tier.flagship': { zh: '旗舰', en: 'Flagship' },
  'settings.activate': { zh: '激活', en: 'Activate' },
  'settings.active': { zh: '已激活', en: 'Active' },
  'settings.edit': { zh: '编辑', en: 'Edit' },
  'settings.delete': { zh: '删除', en: 'Delete' },
  'settings.save': { zh: '保存', en: 'Save' },
  'settings.cancel': { zh: '取消', en: 'Cancel' },
  'settings.deleteConfirm': { zh: '确认删除该模型服务？', en: 'Delete this provider?' },
  'settings.theme': { zh: '主题', en: 'Theme' },
  'settings.theme.dark': { zh: '深色', en: 'Dark' },
  'settings.theme.light': { zh: '浅色', en: 'Light' },
  'settings.language': { zh: '语言', en: 'Language' },
  'settings.lang.zh': { zh: '简体中文' },
  'settings.lang.en': { zh: 'English', en: 'English' },

  // 关于
  'about.desc': { zh: 'AI 原生的一站式科研写作工作站', en: 'AI-native scholarly writing workstation' },
  'about.designDoc': { zh: '设计文档：DESIGN.md（仓库根）', en: 'Design doc: DESIGN.md (repo root)' },

  // 命令面板动作
  'cmd.newProject': { zh: '新建项目（演示重置）', en: 'New project (demo reset)' },
  'cmd.newFile': { zh: '新建文件', en: 'New file' },
  'cmd.save': { zh: '保存当前文件', en: 'Save current file' },
  'cmd.toggleTheme': { zh: '切换深色/浅色主题', en: 'Toggle dark/light theme' },
  'cmd.settings': { zh: '打开设置', en: 'Open settings' },
  'cmd.focusTree': { zh: '聚焦文件树', en: 'Focus file tree' },
  'cmd.clearLog': { zh: '清空编译日志', en: 'Clear compile log' },
  'cmd.compile': { zh: '编译项目', en: 'Compile project' },
  'hint.project': { zh: '项目', en: 'Project' },
  'hint.file': { zh: '文件', en: 'File' },
  'hint.compile': { zh: '编译', en: 'Compile' },
  'hint.app': { zh: '应用', en: 'App' },
  'hint.view': { zh: '视图', en: 'View' },
  'prompt.newFilePath': { zh: '新文件路径（如 sections/notes.tex）', en: 'New file path (e.g. sections/notes.tex)' },

  // Toast
  'toast.projectReset': { zh: '已重置为演示项目', en: 'Demo project loaded' },
  'toast.saved': { zh: '已保存（编辑器接入后生效）', en: 'Saved (effective once editor lands)' },
  'toast.fileCreated': { zh: '文件已创建', en: 'File created' },
  'toast.invalidPath': { zh: '无效的文件路径', en: 'Invalid file path' },

  // 产品代号（暂不提供英文，验证 zh 回退）
  'app.codename': { zh: '论文 IDE' },
};

export function t(key: string, lang: Language = 'zh'): string {
  const entry = dict[key];
  if (!entry) return key;
  return entry[lang] ?? entry.zh;
}

/** 组件内使用：跟随设置语言的翻译函数。 */
export function useT(): (key: string) => string {
  const lang = useSettingsStore((s) => s.language);
  return (key: string) => t(key, lang);
}
