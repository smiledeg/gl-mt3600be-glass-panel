/** 统一的 LuCI 入口：LuCI 在 8080 端口（http），不要再用 443 的 /cgi-bin/luci */
export function luciEntryUrl(path = '/cgi-bin/luci/'): string {
  const host = location.hostname || '192.168.8.1'
  const p = path.startsWith('/') ? path : `/${path}`
  return `http://${host}:8080${p}`
}
