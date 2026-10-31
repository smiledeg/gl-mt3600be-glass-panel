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
    version: '3.0.43-2',
    date: '2026-10-31',
    title: '修复无线终端误显示为有线',
    items: [
      '修复手机/平板等 Wi-Fi 终端在局域网测速「本机」被误显示为「有线连接 · 网口 2500 Mbps」的问题。',
      'Wi-Fi 关联 MAC 与 DHCP 客户端 MAC 不一致（MLO/随机 MAC）时，改为按前 5 段 MAC 前缀匹配；匹配不到也按无线终端显示，不再误判为有线。',
    ],
  },
]
