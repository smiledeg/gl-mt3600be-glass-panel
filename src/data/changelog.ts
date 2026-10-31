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
    version: '3.0.43',
    date: '2026-10-31',
    title: '测速体验优化 + 全局切换动画',
    items: [
      '外网/局域网测速仪表盘量程在单次测试内锁定，目标值改为累积平均并降低平滑速度；删除仪表盘上的最大速度文字。',
      '局域网测速改为三列布局（仪表盘 / 实时曲线与图例 / 结果卡片与进度条），进度条颜色跟随当前主题色。',
      '局域网「本机」显示当前终端真实链路：Wi-Fi 频段、SSID、信号、协商速率，或网线网口速率。',
      '网络测速二级 Tab 增加按方向左右滑动 + 淡入动画；数据加载完成后从上往下淡入。',
      '路由、主题、菜单、卡片、按钮等全局切换统一使用更顺滑的过渡动画。',
    ],
  },
]
