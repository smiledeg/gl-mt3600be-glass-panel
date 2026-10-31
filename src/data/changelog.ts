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
    version: '3.0.43-3',
    date: '2026-10-31',
    title: '手动检查 GitHub 更新',
    items: [
      '关于页新增「检查更新」按钮，只在用户点击时请求 GitHub Releases，不会自动检测。',
      '发现新版本时显示版本号和「前往 GitHub 下载」入口；已是最新则直接提示，不自动下载或安装。',
    ],
  },
]
