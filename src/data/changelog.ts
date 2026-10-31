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
    version: '3.0.41',
    date: '2026-10-30',
    title: '恢复更新内容入口',
    items: [
      '关于页恢复「查看更新内容」入口：面板内只展示当前版本更新，历史版本统一放在 GitHub Releases。',
    ],
  },
]
