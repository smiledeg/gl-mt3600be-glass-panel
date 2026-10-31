/** 原厂 GL 界面入口：加 ?official=1 绕过「默认后台」接管 */
export function officialUrl(path = '/gl_home.html'): string {
  const [base, hash] = String(path).split('#')
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}official=1${hash ? `#${hash}` : ''}`
}
