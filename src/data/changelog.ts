/** 当前版本更新内容：只保留最新版本，历史版本见 GitHub Releases */
export interface ChangelogEntry {
  version: string
  date: string
  title: string
  items: string[]
  early?: boolean
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '3.1.0-4',
    date: '2026-11-04',
    title: '移除插件管理页',
    items: [
      '删除「应用 → 插件管理」页面及其菜单入口；直接访问旧地址自动跳转到文件共享。',
      '保留文件共享、AdGuard Home 等其它应用页面。',
    ],
  },
]
