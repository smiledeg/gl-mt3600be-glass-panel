import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, isDemo } from '@/api'

const SID_KEY = 'nui.sid'
const SHARED_SID_KEY = 'nui.sid.shared'
const USER_KEY = 'nui.user'

function hasSession(): boolean {
  return !!(sessionStorage.getItem(SID_KEY) || localStorage.getItem(SHARED_SID_KEY))
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref(sessionStorage.getItem(USER_KEY) || 'root')
  const loggedIn = ref(isDemo || hasSession())
  const busy = ref(false)
  const error = ref<string | null>(null)
  /** 上一次是否是“会话过期”被踢回登录页（登录页用来提示） */
  const expired = ref(false)

  const isDemoMode = computed(() => api.kind === 'demo')

  async function login(username: string, password: string) {
    busy.value = true
    error.value = null
    try {
      await api.login(username, password)
      user.value = username
      loggedIn.value = true
      expired.value = false
      sessionStorage.setItem(USER_KEY, username)
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      busy.value = false
    }
  }

  async function logout() {
    await api.logout().catch(() => {})
    sessionStorage.removeItem(SID_KEY)
    localStorage.removeItem(SHARED_SID_KEY)
    loggedIn.value = false
  }

  /** 会话保活：GL gl-session 默认 300 秒过期，最多 5 个并发会话 */
  async function keepAlive(): Promise<boolean> {
    if (isDemo) return true
    if (!loggedIn.value) return false
    const ok = await api.alive().catch(() => false)
    if (!ok) loggedIn.value = false
    return ok
  }

  /** 被 rpc 层判定会话失效时调用：清本地登录态，让界面跳登录 */
  function markExpired() {
    loggedIn.value = false
    expired.value = true
    sessionStorage.removeItem(SID_KEY)
    localStorage.removeItem(SHARED_SID_KEY)
  }

  return { user, loggedIn, busy, error, expired, isDemoMode, login, logout, keepAlive, markExpired }
})
