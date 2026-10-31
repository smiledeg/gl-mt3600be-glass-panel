import type { GlobalThemeOverrides } from 'naive-ui'

export const ACCENT = '#2080f0'

export const COLORS = {
  ok: '#18a058',
  warn: '#f0a020',
  err: '#d03050',
  info: ACCENT,
}

export const levelColor = (level: 'ok' | 'warn' | 'err'): string => COLORS[level]

function clampByte(v: number) {
  return Math.max(0, Math.min(255, Math.round(v)))
}

/** #rrggbb 调亮/调暗（factor > 0 变亮，< 0 变暗） */
export function shiftColor(hex: string, factor: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''))
  if (!m) return hex || ACCENT
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const t = factor >= 0 ? 255 : 0
  const k = Math.abs(factor)
  return (
    '#' +
    [r, g, b]
      .map((c) => clampByte(c + (t - c) * k).toString(16).padStart(2, '0'))
      .join('')
  )
}

/** 主题色 + 圆角 → Naive UI 主题覆盖（界面设置里改色/改圆角时全局立即生效） */
export function buildThemeOverrides(accent: string, radiusPx: number): GlobalThemeOverrides {
  const base = /^#[0-9a-f]{6}$/i.test(accent) ? accent : ACCENT
  const hover = shiftColor(base, 0.18)
  const pressed = shiftColor(base, -0.18)
  const active = `rgba(${parseInt(base.slice(1, 3), 16)}, ${parseInt(base.slice(3, 5), 16)}, ${parseInt(base.slice(5, 7), 16)}, 0.14)`
  return {
    common: {
      primaryColor: base,
      primaryColorHover: hover,
      primaryColorPressed: pressed,
      primaryColorSuppl: hover,
      borderRadius: `${radiusPx}px`,
      borderRadiusSmall: `${Math.max(4, radiusPx - 4)}px`,
      fontSize: '14px',
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
    },
    Card: {
      borderRadius: `${radiusPx}px`,
      paddingMedium: '14px 18px 16px',
      paddingSmall: '12px 16px 14px',
      titleFontSizeMedium: '15px',
      titleFontWeight: '600',
    },
    Menu: {
      itemHeight: '40px',
      borderRadius: `${Math.max(4, radiusPx - 6)}px`,
      itemColorActive: active,
      itemColorActiveHover: active,
      itemTextColorActive: base,
      itemIconColorActive: base,
    },
    DataTable: {
      thColor: 'transparent',
      tdColor: 'transparent',
      thTextColor: 'rgba(128,128,128,0.9)',
      thFontWeight: '500',
      borderColor: 'transparent',
      thPaddingMedium: '8px 12px',
      tdPaddingMedium: '10px 12px',
    },
    Progress: { railHeight: '6px' },
    Tag: { borderRadius: `${Math.max(4, radiusPx - 7)}px` },
  }
}

/** 兼容旧引用：默认主题覆盖（静态 blue/14px） */
export const themeOverrides: GlobalThemeOverrides = buildThemeOverrides(ACCENT, 14)
