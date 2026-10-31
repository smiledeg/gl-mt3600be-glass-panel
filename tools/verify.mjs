#!/usr/bin/env node
/**
 * 真机 E2E 巡检 + 截图（puppeteer-core + 本机 Edge）
 *
 *   node tools/verify.mjs                         # 全部路由，截图到 docs/screens/
 *   node tools/verify.mjs --routes /overview,/vpn/dashboard
 *   GL_PASS=<后台密码> node tools/verify.mjs --host 192.168.8.1 --base https://192.168.8.1/glass/
 *
 * 输出：
 *   docs/screens/<route>.png   每页截图
 *   docs/verify.json           每页 { status, ok, textLen, errors[], missing[] }
 *   控制台摘要 + 退出码（有页面异常/白屏 → 非 0）
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

const argv = process.argv.slice(2)
const opt = (name, def) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def
}
const HOST = opt('host', '192.168.8.1')
const PASS = opt('pass', process.env.GL_PASS || '')
if (!PASS) {
  console.error('请通过 --pass 或 GL_PASS 提供后台密码')
  process.exit(1)
}
const USER = opt('user', 'root')
const BASE = opt('base', `https://${HOST}/glass/`)
const OUT = opt('out', 'docs/screens')
const REPORT = opt('report', 'docs/verify.json')
const EDGE =
  process.env.EDGE_PATH ||
  ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(
    (p) => existsSync(p),
  )
if (!EDGE) {
  console.error('找不到 Edge，可用 EDGE_PATH 指定 chrome/edge 路径')
  process.exit(2)
}

/** 全部路由 = 侧栏 NAV（与 src/router/index.ts 保持一致，新增页面记得加） */
const ROUTES = [
  '/overview',
  '/cellular/status', '/cellular/sim', '/cellular/lock', '/cellular/data', '/cellular/at', '/cellular/sms',
  '/internet/wan', '/internet/multiwan',
  '/wireless/wifi', '/wireless/guest', '/wireless/repeater', '/wireless/acl',
  '/clients',
  '/network/lan', '/network/dhcp', '/network/dns', '/network/ipv6', '/network/nat', '/network/routes', '/network/igmp', '/network/adv',
  '/security/firewall', '/security/acl', '/security/remote', '/security/parental', '/security/dpi',
  '/flow/stats', '/flow/qos', '/flow/sqm',
  '/vpn/dashboard', '/vpn/client', '/vpn/wg-server', '/vpn/ovpn-server', '/vpn/tailscale', '/vpn/zerotier', '/vpn/tor',
  '/cloud/goodcloud', '/cloud/ddns', '/cloud/sdwan',
  '/apps/store', '/apps/nas', '/apps/adguard',
  '/tools/speedtest', '/tools/diag', '/tools/monitor', '/tools/conn',
  '/system/info', '/system/password', '/system/upgrade', '/system/timer', '/system/timezone', '/system/button',
  '/system/fan', '/system/reset', '/system/logs', '/system/advanced', '/system/ui',
  '/about',
]
const only = opt('routes', '')
const routes = only ? only.split(',').map((s) => s.trim()).filter(Boolean) : ROUTES

mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--ignore-certificate-errors', '--no-sandbox', '--disable-dev-shm-usage', '--lang=zh-CN'],
  defaultViewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },
})

const results = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  const page = await browser.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 200))
  })
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)))

  console.log('== 打开', BASE)
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await sleep(1200)

  // 登录（密码框是第二个 input）
  const needLogin = await page.evaluate(() => !document.querySelector('.shell'))
  if (needLogin) {
    const inputs = await page.$$('input')
    if (inputs.length >= 2) {
      await inputs[1].click({ clickCount: 3 })
      await inputs[1].type(PASS, { delay: 12 })
    } else {
      console.warn('!! 找不到密码输入框，页面可能不是登录页')
    }
    const btn = await page.$('button.n-button--primary-type, button')
    if (btn) await btn.click()
    await sleep(2500)
    const ok = await page.evaluate(() => !!document.querySelector('.shell'))
    console.log(ok ? '== 登录成功' : '!! 登录可能失败（仍继续巡检）')
  } else {
    console.log('== 已登录（会话复用）')
  }

  for (const route of routes) {
    const url = `${BASE}#${route}`
    const errors = []
    const onConsole = (m) => {
      if (m.type() === 'error') errors.push(m.text().slice(0, 300))
    }
    const onErr = (e) => errors.push('pageerror: ' + String(e).slice(0, 300))
    page.on('console', onConsole)
    page.on('pageerror', onErr)

    let status = 0
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 })
      await sleep(3600) // 等页面接口返回与渲染
    } catch (e) {
      status = -1
      errors.push('goto: ' + String(e).slice(0, 200))
    }

    const info = await page.evaluate(() => {
      const body = document.body
      const text = (body?.innerText || '').replace(/\s+/g, ' ').trim()
      const alerts = [...document.querySelectorAll('.n-alert')].map((n) => (n.textContent || '').trim().slice(0, 120))
      const empty = [...document.querySelectorAll('.n-empty__description, .n-empty')].map((n) => (n.textContent || '').trim().slice(0, 120))
      return {
        textLen: text.length,
        hasSpinner: !!document.querySelector('.n-spin-body .n-spin'),
        alerts,
        empty,
        title: document.querySelector('.crumb-title')?.textContent?.trim() || '',
        path: location.hash,
      }
    })

    const name = route.replace(/^\//, '').replace(/\//g, '_')
    const shot = join(OUT, `${name}.png`)
    try {
      await page.screenshot({ path: shot, fullPage: true })
    } catch (e) {
      errors.push('screenshot: ' + String(e).slice(0, 120))
    }

    const ok = status === 0 && info.textLen > 60 && errors.length === 0
    results.push({ route, ok, textLen: info.textLen, title: info.title, alerts: info.alerts, empty: info.empty, errors, shot })
    console.log(
      `${ok ? 'OK ' : 'BAD'} ${route.padEnd(24)} text=${String(info.textLen).padStart(4)} alerts=${info.alerts.length} empty=${info.empty.length}${errors.length ? ' errors=' + errors.length : ''}`,
    )
    page.off('console', onConsole)
    page.off('pageerror', onErr)
  }
} finally {
  await browser.close()
}

const bad = results.filter((r) => !r.ok)
const summary = {
  at: new Date().toISOString(),
  base: BASE,
  total: results.length,
  ok: results.length - bad.length,
  bad: bad.length,
  pages: results,
}
mkdirSync(join('docs'), { recursive: true })
writeFileSync(REPORT, JSON.stringify(summary, null, 2))
console.log(`\n== ${summary.ok}/${summary.total} 页通过；报告 ${REPORT}`)
if (bad.length) {
  console.log('-- 问题页 --')
  for (const b of bad) console.log(' ', b.route, '|', b.errors.slice(0, 3).join(' ; ') || `text=${b.textLen}`)
}
process.exit(bad.length ? 1 : 0)
