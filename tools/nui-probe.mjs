#!/usr/bin/env node
/**
 * NUI 桥真机巡检（/rpc -> nui.invoke）
 *
 *   node tools/nui-probe.mjs                  # 登录 → nui.methods → 逐个只读方法 invoke
 *   node tools/nui-probe.mjs --active         # 只读巡检后，再跑"有副作用的真实操作"（诊断/测速/wifi 扫描）
 *   node tools/nui-probe.mjs --filter=cell    # 只跑方法名含 cell 的只读方法
 *   node tools/nui-probe.mjs --timeout=60000  # 单次调用超时（默认 20000ms）
 *   node tools/nui-probe.mjs --no-write-note  # 不打印写方法清单
 *
 * 输出：docs/samples/nui-methods.json（方法矩阵 + 主动测试样例）+ 控制台摘要。
 *
 * 安全约定：
 *  - 默认只调用 write=false 的方法；login/logout 永不自动调用；
 *  - 写方法只记录存在性，不真调（配置类写入）；
 *  - --active 只跑"临时会话类"操作：wifi 扫描、ping 诊断、下载测速，跑完即停止，
 *    不写任何 /etc/config；测速用最小参数（duration=5, conn=1, cap=50）。
 *
 * 环境变量：GL_HOST(192.168.8.1) GL_USER(root) GL_PASS(必填)
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED ||= '0'

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { login } from './glrpc.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const HOST = process.env.GL_HOST || '192.168.8.1'
const BASE = `https://${HOST}/rpc`

const argv = process.argv.slice(2)
const opt = (name, dflt) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return dflt
  const eq = hit.indexOf('=')
  return eq >= 0 ? hit.slice(eq + 1) : true
}
const DEFAULT_TIMEOUT = Number(opt('timeout', 20000))
const FILTER = opt('filter', null)
const SHOW_WRITE = !opt('no-write-note', false)
const ACTIVE = !!opt('active', false)
const ACTIVE_ONLY = !!opt('active-only', false)

let msgId = 1
async function post(payload, timeoutMs) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs || DEFAULT_TIMEOUT)
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: ac.signal,
    })
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`非 JSON 响应 (HTTP ${res.status}): ${text.slice(0, 160)}`)
    }
  } finally {
    clearTimeout(timer)
  }
}

async function rpcCall(sid, object, method, params = {}, timeoutMs) {
  const res = await post(
    { jsonrpc: '2.0', id: msgId++, method: 'call', params: [sid, object, method, params] },
    timeoutMs,
  )
  if (res.error) {
    const e = new Error(
      typeof res.error === 'object' ? res.error.message || JSON.stringify(res.error) : String(res.error),
    )
    e.rpcError = res.error
    throw e
  }
  return res.result
}

// ---------------------------------------------------------------------------
// 只读方法的“合理参数”。设备上拿不到的状态给最小合法值，参数不合法时模块会返回
// 明确错误，正好记录成矩阵里的 ERR 原因。
// ---------------------------------------------------------------------------
const ARGS = {
  'adv.hosts_test': { name: 'baidu.com' },
  'app.progress': { name: 'nui-speed' },
  'at.devinfo_get': { iface: 'cpe' },
  'cell.config': { iface: 'cpe' },
  'cell.number_region': { number: '13800138000', lookup: false }, // 只看号段缓存/不发外部请求
  'cell.slots': { iface: 'cpe' },
  'diag.poll': { offset: 0 },
  'net.public_ip': { force: false },
  'speed.cn_nodes': { force: false },
  'speed.exp_items': { force: false },
  'speed.exp_poll': { kind: 'web' }, // 不启动测速时读到 idle 状态（kind 必填）
  'speed.probe': { force: false },
  'sys.log': { lines: 20 },
  'wifi.scan_result': { band: '2g' },
}
// 这些方法单次允许更久（网络探测/外网请求）
const TIMEOUTS = {
  'adv.hosts_test': 15000,
  'net.public_ip': 30000,
  'speed.probe': 60000,
  'speed.cn_nodes': 30000,
  'speed.exp_items': 15000,
}
// 绝不自动调用：login 需要密码（桥不需要，GL /rpc 已登录）；logout 会销毁会话
const NEVER = new Set(['login', 'logout'])

function truncate(v, max = 1600) {
  let s
  try {
    s = JSON.stringify(v)
  } catch {
    s = String(v)
  }
  if (s === undefined) return '(undefined)'
  return s.length > max ? s.slice(0, max) + `…(${s.length}B)` : s
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  console.log(`== NUI 桥巡检 ${BASE} ==`)
  const sid = await login()
  console.log(`login ok, sid=${sid.slice(0, 8)}…`)

  const ping = await rpcCall(sid, 'nui', 'ping')
  console.log('nui.ping ->', JSON.stringify(ping))

  const methodsRes = await rpcCall(sid, 'nui', 'methods')
  const meta = methodsRes && methodsRes.data ? methodsRes.data : {}
  const methods = Array.isArray(meta.methods) ? meta.methods : []
  console.log(
    `nui.methods -> ${methods.length} 个方法, version=${meta.version}, errors=${JSON.stringify(meta.errors || {})}`,
  )

  const invoke = (method, args = {}, timeoutMs) =>
    rpcCall(sid, 'nui', 'invoke', { method, args }, timeoutMs || DEFAULT_TIMEOUT)

  // ---------------- 只读巡检 ----------------
  const targets = methods.filter((m) => {
    if (ACTIVE_ONLY) return false
    if (m.write) return false
    if (NEVER.has(m.name)) return false
    if (FILTER && !m.name.includes(String(FILTER))) return false
    return true
  })
  const skippedWrite = methods.filter((m) => m.write)

  if (SHOW_WRITE) {
    console.log(
      `写方法 ${skippedWrite.length} 个（默认只记录，不调用）: ${skippedWrite.map((m) => m.name).join(', ')}`,
    )
  }
  if (NEVER.size) console.log(`跳过: ${[...NEVER].join(', ')}`)

  const results = []
  let ok = 0
  let err = 0
  for (const m of targets) {
    const args = ARGS[m.name] || {}
    const t0 = Date.now()
    let row
    try {
      const r = await invoke(m.name, args, TIMEOUTS[m.name])
      const ms = Date.now() - t0
      if (r && r.ok === true) {
        ok++
        row = { name: m.name, module: m.module, write: !!m.write, ok: true, ms, sample: truncate(r.data) }
      } else {
        err++
        row = {
          name: m.name,
          module: m.module,
          write: !!m.write,
          ok: false,
          ms,
          code: (r && r.code) || 'UNKNOWN',
          error: (r && r.error) || '(无错误信息)',
        }
      }
    } catch (e) {
      const ms = Date.now() - t0
      err++
      row = {
        name: m.name,
        module: m.module,
        write: !!m.write,
        ok: false,
        ms,
        code: e.rpcError ? `RPC_${e.rpcError.code}` : e.name === 'AbortError' ? 'TIMEOUT' : 'NET',
        error: e.rpcError ? e.rpcError.message : String(e.message || e),
      }
    }
    row.args = args
    results.push(row)
    const tag = row.ok ? 'OK ' : 'ERR'
    console.log(`${tag} ${row.name} (${row.ms}ms)${row.ok ? '' : ' :: ' + row.code + ' ' + row.error}`)
  }

  // ---------------- 主动测试（可选） ----------------
  const active = ACTIVE || ACTIVE_ONLY ? await activeSuite(sid, invoke) : null

  const summary = {
    host: HOST,
    generatedAt: new Date().toISOString(),
    bridge: { ping, version: meta.version, count: methods.length, loadErrors: meta.errors || {} },
    stats: {
      total: methods.length,
      readonly: targets.length,
      okCount: ok,
      errCount: err,
      writeCount: skippedWrite.length,
    },
    writeMethods: skippedWrite.map((m) => ({ name: m.name, module: m.module })),
    methods: results,
    activeTests: active,
  }

  const outDir = join(ROOT, 'docs', 'samples')
  mkdirSync(outDir, { recursive: true })
  const outFile = join(outDir, 'nui-methods.json')
  writeFileSync(outFile, JSON.stringify(summary, null, 2) + '\n', 'utf8')

  const byModule = {}
  for (const r of results) {
    byModule[r.module] ||= { ok: 0, err: 0 }
    byModule[r.module][r.ok ? 'ok' : 'err']++
  }
  console.log('\n== 摘要 ==')
  for (const [mod, s] of Object.entries(byModule).sort()) {
    console.log(`  ${mod.padEnd(12)} OK ${s.ok}  ERR ${s.err}`)
  }
  console.log(`  合计 OK ${ok} / ERR ${err} / 只读 ${targets.length} / 写 ${skippedWrite.length}`)
  if (err) {
    console.log('\n== 失败方法 ==')
    for (const r of results.filter((x) => !x.ok)) console.log(`  ${r.name} :: ${r.code} ${r.error}`)
  }
  if (active) {
    console.log('\n== 主动测试 ==')
    for (const a of active) console.log(`  ${a.ok ? 'OK ' : 'ERR'} ${a.name} (${a.ms}ms)${a.ok ? '' : ' :: ' + a.error}`)
  }
  console.log(`\n已写入 ${outFile}`)
}

// ---------------------------------------------------------------------------
// 主动测试：临时会话类操作，跑完恢复原状，不写 /etc/config
// ---------------------------------------------------------------------------
async function activeSuite(sid, invoke) {
  const rows = []
  async function step(name, fn) {
    const t0 = Date.now()
    try {
      const data = await fn()
      const r = { name, ok: true, ms: Date.now() - t0, sample: truncate(data, 2000) }
      rows.push(r)
      console.log(`OK  [active] ${name} (${r.ms}ms)`)
      return data
    } catch (e) {
      const r = { name, ok: false, ms: Date.now() - t0, error: String(e.message || e) }
      rows.push(r)
      console.log(`ERR [active] ${name} :: ${r.error}`)
      return null
    }
  }
  const nui = async (method, args, timeoutMs) => {
    const r = await invoke(method, args, timeoutMs)
    if (!r || r.ok !== true) {
      const e = new Error(`${r && r.code ? r.code + ' ' : ''}${(r && r.error) || '未知错误'}`)
      e.result = r
      throw e
    }
    return r.data
  }

  // 1) Wi-Fi 扫描（2.4G，临时扫描，不写配置）
  await step('wifi.scan(2g)', () => nui('wifi.scan', { band: '2g' }, 30000))
  await step('wifi.scan_result(2g)', () => nui('wifi.scan_result', { band: '2g' }, 30000))

  // 2) 网络诊断：ping 本机回环（2 个包，不产生外网流量）
  try {
    await step('diag.start(ping 127.0.0.1 x2)', () =>
      nui('diag.start', { kind: 'ping', host: '127.0.0.1', count: 2 }, 15000),
    )
    let offset = 0
    let text = ''
    let done = false
    for (let i = 0; i < 20 && !done; i++) {
      await sleep(500)
      const p = await nui('diag.poll', { offset }, 15000).catch(() => null)
      if (!p) break
      text += p.text || ''
      offset = p.offset
      done = p.done === true
      if (done) break
    }
    rows.push({
      name: 'diag.poll(until done)',
      ok: done,
      ms: 0,
      sample: truncate({ text: text.slice(0, 1500), done }),
    })
    console.log(`${done ? 'OK ' : 'ERR'} [active] diag.poll 输出 ${text.split('\n').filter(Boolean).length} 行`)
  } finally {
    await step('diag.stop', () => nui('diag.stop', {}, 15000))
  }

  // 3) 测速：最小参数（10 秒 / 1 连接 / 50KB 分片），轮询到结束，最后确保 stop
  try {
    await step('speed.start(auto,duration=10,conn=1,cap=50)', () =>
      nui('speed.start', { server: 'auto', duration: 10, conn: 1, cap: 50 }, 60000),
    )
    let last = null
    // 测速脚本结束前可能有一小段"状态文件里还是 starting"的窗口，模块会先报 stopped；
    // 这里不提前认输，等到 phase=done/error 或 45 秒超时。
    for (let i = 0; i < 45; i++) {
      await sleep(1000)
      last = await nui('speed.poll', {}, 15000).catch(() => null)
      if (!last) break
      if (last.phase === 'done' || last.phase === 'error') break
    }
    const finished = last && last.phase === 'done'
    rows.push({
      name: 'speed.poll(until done)',
      ok: finished,
      ms: 0,
      sample: truncate(last),
    })
    console.log(`[active] speed.poll 最终 phase=${last && last.phase}`)
  } finally {
    await step('speed.stop', () => nui('speed.stop', {}, 15000))
  }

  return rows
}

main().catch((e) => {
  console.error('巡检失败:', e)
  process.exitCode = 1
})
