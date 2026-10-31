/** 登录页「记住我」：仅在本机浏览器保存，带简单混淆（不是加密，公共设备请勿勾选） */
const FLAG = 'nui.remember'
const CRED = 'nui.remember.cred'

export interface RememberedCred {
  username: string
  password: string
}

function enc(s: string): string {
  try {
    return btoa(unescape(encodeURIComponent(s)))
  } catch {
    return ''
  }
}
function dec(s: string): string {
  try {
    return decodeURIComponent(escape(atob(s)))
  } catch {
    return ''
  }
}

export function rememberEnabled(): boolean {
  return localStorage.getItem(FLAG) === '1'
}

export function loadRemembered(): RememberedCred | null {
  if (!rememberEnabled()) return null
  const raw = localStorage.getItem(CRED)
  if (!raw) return null
  try {
    const o = JSON.parse(dec(raw))
    if (typeof o?.username === 'string' && typeof o?.password === 'string' && o.password) return o
  } catch {
    /* ignore */
  }
  return null
}

export function saveRemembered(c: RememberedCred) {
  localStorage.setItem(FLAG, '1')
  localStorage.setItem(CRED, enc(JSON.stringify({ username: c.username, password: c.password })))
}

export function forgetRemembered() {
  localStorage.removeItem(FLAG)
  localStorage.removeItem(CRED)
}
