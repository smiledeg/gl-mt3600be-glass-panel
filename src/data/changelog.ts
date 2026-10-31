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
    version: '3.1.0-1',
    date: '2026-10-31',
    title: '3.1 手动更新检测测试版',
    items: [
      '用于验证关于页「检查更新」：当前设备 3.0.43-3 应能检测到 3.1.0-1。',
      '本版本没有额外功能改动，仅版本号更新；不会自动下载或安装。',
    ],
  },
]
