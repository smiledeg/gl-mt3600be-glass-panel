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
    version: '3.1.0-2',
    date: '2026-11-01',
    title: '无风扇/无按钮设备自动降级',
    items: [
      '新增硬件能力探测：按 sysfs 判断是否真的有风扇，避免 0 RPM 或无风扇设备仍显示风扇转速。',
      '没有风扇时「风扇与温度」自动变为「温度」，只显示温度；系统信息卡也不再显示 RPM。',
      '没有拨动开关能力时隐藏「按钮设置」入口。',
    ],
  },
]
