import { api } from '@/api'

export interface RatePoint {
  t: number
  rx: number
  tx: number
}

export interface RateHistory {
  enabled: boolean
  interval: number
  points: RatePoint[]
}

/** 首页实时速率历史（glass-rate 服务记录，仅内存最近 3 分钟） */
export async function getRateHistory(limit = 60): Promise<RateHistory> {
  try {
    const r = await api.call<RateHistory>('glass', 'rate_history', { limit })
    return {
      enabled: !!r?.enabled,
      interval: Number(r?.interval) || 3,
      points: Array.isArray(r?.points) ? r.points : [],
    }
  } catch {
    return { enabled: false, interval: 3, points: [] }
  }
}

export async function setRateHistory(enabled: boolean): Promise<boolean> {
  const r = await api.call<{ enabled: boolean }>('glass', 'rate_history_set', { enabled })
  return !!(r && r.enabled)
}
