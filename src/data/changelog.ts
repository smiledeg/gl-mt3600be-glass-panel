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
    version: '3.0.42',
    date: '2026-10-31',
    title: '修复 postinst 未找到（安装返回 127）',
    items: [
      '修复 ipk 控制脚本 postinst 使用 CRLF 换行，导致 opkg 执行时 /bin/sh: postinst: not found（状态 127）的问题。',
      '控制脚本统一改为 LF 换行，ipk/apk 均重新打包；安装/升级不再报 postinst 失败。',
    ],
  },
]
