#!/usr/bin/env node
/**
 * GL SDK4 JSON-RPC 命令行客户端（用于开发期侦察真机接口）
 *
 *   node tools/glrpc.mjs <object> <method> [json-params]
 *   node tools/glrpc.mjs --raw '{"jsonrpc":"2.0",...}'
 *   node tools/glrpc.mjs --menu            # 打印原厂菜单树
 *   node tools/glrpc.mjs --objs            # 逐个 get_config/get_status 探测所有对象
 *
 * 环境变量: GL_HOST(默认 192.168.8.1) GL_USER(root) GL_PASS(必填) GL_INSECURE=1
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const HOST = process.env.GL_HOST || '192.168.8.1'
const USER = process.env.GL_USER || 'root'
const PASS = process.env.GL_PASS || ''
if (!PASS) {
  console.error('请设置 GL_PASS 环境变量（路由器后台密码）')
  process.exit(1)
}
const BASE = `https://${HOST}/rpc`

let id = 1
async function post(payload) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    // 自签证书
    ...(globalThis.process?.env?.GL_VERIFY ? {} : {}),
  })
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`非 JSON 响应 (HTTP ${res.status}): ${text.slice(0, 200)}`)
  }
}

const sha256hex = (s) => createHash('sha256').update(s).digest('hex')

const ITOA64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
function b64From24(b2, b1, b0, n, out) {
  let w = (b2 << 16) | (b1 << 8) | b0
  for (let i = 0; i < n; i++) {
    out.push(ITOA64.charAt(w & 0x3f))
    w >>>= 6
  }
}
/** sha256-crypt ($5$salt$digest)，GL 登录用 */
export function sha256crypt(password, salt) {
  const pw = Buffer.from(password, 'utf8')
  const sl = Buffer.from(String(salt).slice(0, 16), 'utf8')
  const H = (buf) => createHash('sha256').update(buf).digest()
  const cat = (arr) => Buffer.concat(arr)

  const B = H(Buffer.concat([pw, sl, pw]))
  const parts = [pw, sl]
  let cnt
  for (cnt = pw.length; cnt > 32; cnt -= 32) parts.push(B)
  if (cnt > 0) parts.push(B.subarray(0, cnt))
  for (cnt = pw.length; cnt > 0; cnt >>= 1) parts.push(cnt & 1 ? B : pw)
  let C = H(cat(parts))

  const pb = []
  for (let i = 0; i < pw.length; i++) pb.push(pw)
  const P = repeatTo(H(cat(pb)), pw.length)

  const sb = []
  for (let i = 0; i < 16 + C[0]; i++) sb.push(sl)
  const S = repeatTo(H(cat(sb)), sl.length)

  for (let r = 0; r < 5000; r++) {
    const ps = [r & 1 ? P : C]
    if (r % 3) ps.push(S)
    if (r % 7) ps.push(P)
    ps.push(r & 1 ? C : P)
    C = H(cat(ps))
  }
  const out = []
  b64From24(C[0], C[10], C[20], 4, out)
  b64From24(C[21], C[1], C[11], 4, out)
  b64From24(C[12], C[22], C[2], 4, out)
  b64From24(C[3], C[13], C[23], 4, out)
  b64From24(C[24], C[4], C[14], 4, out)
  b64From24(C[15], C[25], C[5], 4, out)
  b64From24(C[6], C[16], C[26], 4, out)
  b64From24(C[27], C[7], C[17], 4, out)
  b64From24(C[18], C[28], C[8], 4, out)
  b64From24(C[9], C[19], C[29], 4, out)
  b64From24(0, C[31], C[30], 3, out)
  return '$5$' + sl.toString() + '$' + out.join('')
}
function repeatTo(bytes, len) {
  const out = Buffer.alloc(len)
  if (!bytes.length) return out
  for (let i = 0; i < len; i++) out[i] = bytes[i % bytes.length]
  return out
}
export const loginHash = (user, pass, salt, nonce) =>
  sha256hex(`${user}:${sha256crypt(pass, salt)}:${nonce}`)

export async function login() {
  const ch = await post({ jsonrpc: '2.0', id: id++, method: 'challenge', params: { username: USER } })
  if (ch.error) throw new Error('challenge: ' + JSON.stringify(ch.error))
  const { salt, nonce } = ch.result || {}
  const res = await post({
    jsonrpc: '2.0',
    id: id++,
    method: 'login',
    params: { username: USER, hash: loginHash(USER, PASS, salt, nonce) },
  })
  if (res.error) throw new Error('login: ' + JSON.stringify(res.error))
  return res.result.sid
}

export async function call(sid, object, method, params = {}) {
  const res = await post({ jsonrpc: '2.0', id: id++, method: 'call', params: [sid, object, method, params] })
  if (res.error) {
    const e = new Error(typeof res.error === 'object' ? JSON.stringify(res.error) : String(res.error))
    e.rpc = res.error
    throw e
  }
  return res.result
}

// ---------------- CLI ----------------
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('glrpc.mjs')) {
  const argv = process.argv.slice(2)
  https: {
  }
  // 自签证书：Node 18+ 用 NODE_TLS_REJECT_UNAUTHORIZED=0（由调用方设置）
  if (!process.env.NODE_TLS_REJECT_UNAUTHORIZED) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  const sid = await login()
  if (argv[0] === '--menu') {
    const menu = await call(sid, 'ui', 'get_menu_list')
    console.log(JSON.stringify(menu, null, 2))
  } else if (argv[0] === '--objs') {
    const objs = (process.env.GL_OBJS || 'system,wifi,clients,lan,network,firewall,cloud,ddns,mptun,upgrade,logread,led,timer,fan,fanctrl,acl,dpi,qos,tethering,repeater,netmode,ipv6,kmwan,ui,plugins,nas,parental-control,sms-forward,srv_conn_check,s2s,tor,tailscale,zerotier,ovpn_client,ovpn_server,wg_client,wg-server,igmp,flow_statistics,adguardhome,black_white_list,dns,edgerouter,local-access,switch-button,rtty,sqm,kmwan,mptun,glass').split(',')
    for (const o of objs) {
      for (const m of ['get_config', 'get_status']) {
        try {
          const r = await call(sid, o, m)
          console.log(`OK  ${o}.${m} ${JSON.stringify(r).slice(0, 400)}`)
        } catch (e) {
          console.log(`ERR ${o}.${m} ${String(e.message).slice(0, 120)}`)
        }
      }
    }
  } else if (argv[0] === '--raw') {
    console.log(JSON.stringify(await post(JSON.parse(argv[1])), null, 2))
  } else {
    const [object, method, paramsRaw] = argv
    let params = {}
    if (paramsRaw === '-') {
      params = JSON.parse(readFileSync(0, 'utf8'))
    } else if (paramsRaw) {
      params = JSON.parse(paramsRaw)
    }
    const r = await call(sid, object, method, params)
    console.log(JSON.stringify(r, null, 2))
  }
}
