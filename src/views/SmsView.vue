<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NIcon,
  NInput,
  NPopconfirm,
  NSelect,
  NTag,
  useMessage,
} from 'naive-ui'
import {
  ChatbubbleEllipsesOutline,
  InformationCircleOutline,
  MailOpenOutline,
  MailUnreadOutline,
  SendOutline,
  TrashOutline,
  WarningOutline,
} from '@vicons/ionicons5'
import PanelCard from '@/components/PanelCard.vue'
import PageState from '@/components/PageState.vue'
import { useAsync, shortError, usePolling } from '@/composables/useAsync'
import { fmtAgo } from '@/utils/format'
import {
  clearCellularCache,
  getSmsPage,
  smsMarkAllRead,
  smsMarkRead,
  smsRemove,
  smsRemoveScope,
  smsSend,
  type SmsBundle,
  type SmsItem,
} from '@/api/cellular'

/**
 * 短信页（/cellular/sms）
 * 官方 API（docs/api-official.md §sms）：modem.get_sms_list / set_sms / remove_sms / send_sms。
 * 本机无蜂窝模组：get_sms_list 返回 "Bus does not exist" → 页面显示「无蜂窝模组，短信不可用」+ 真实诊断证据。
 */
const message = useMessage()
const bus = ref('')

const { data, loading, error, reload, lastAt } = useAsync<SmsBundle>(() => getSmsPage(bus.value), {
  interval: 15000,
})
const sms = computed(() => data.value)

const tab = ref<'receive' | 'send'>('receive')
const selected = ref<SmsItem | null>(null)
const busy = ref(false)

usePolling(() => {
  if (sms.value?.supported && !document.hidden) void reload(true)
}, 10000)

/* ---------------- 分类 ---------------- */
const receiveList = computed(() => (sms.value?.list ?? []).filter((s) => s.status === 0 || s.status === 1))
const sendList = computed(() => (sms.value?.list ?? []).filter((s) => s.status !== 0 && s.status !== 1))
const curList = computed(() => (tab.value === 'receive' ? receiveList.value : sendList.value))
const unread = computed(() => receiveList.value.filter((s) => s.unread).length)
const busOptions = computed(() =>
  (sms.value?.probe.devices ?? []).map((d) => ({ label: d.bus + (d.name ? ` · ${d.name}` : ''), value: d.bus })),
)
const slotOptions = computed(() => {
  const list = sms.value?.slots ?? []
  if (!list.length) return [{ label: '卡槽 1', value: 1 }]
  return list.map((s) => ({ label: `卡槽 ${s.slot}${s.number ? ` · ${s.number}` : ''}`, value: s.slot }))
})

watch(
  () => sms.value?.bus,
  (v) => {
    if (v) bus.value = v
  },
  { immediate: true },
)

/* ---------------- 展示 ---------------- */
function fmtDate(v: string): string {
  if (!v) return '—'
  const n = Number(v)
  if (Number.isFinite(n) && n > 1e9) {
    const ms = n > 1e12 ? n : n * 1000
    return new Date(ms).toLocaleString('zh-CN')
  }
  return v
}
function statusText(s: SmsItem): string {
  if (s.status === 0) return '未读'
  if (s.status === 1) return '已读'
  if (s.status === 3 || s.status === 4) return '发送中'
  if (s.status === 5) return '发送失败'
  return `状态 ${s.status}`
}
function statusType(s: SmsItem): 'success' | 'warning' | 'error' | 'default' {
  if (s.status === 5) return 'error'
  if (s.status === 3 || s.status === 4) return 'warning'
  if (s.status === 0) return 'success'
  return 'default'
}
const updatedText = computed(() => (lastAt.value ? `更新于 ${fmtAgo(lastAt.value)}` : '读取中…'))

async function openItem(s: SmsItem) {
  selected.value = s
  if (tab.value === 'receive' && s.status === 0 && sms.value?.bus) {
    try {
      await smsMarkRead(sms.value.bus, s.name)
      void reload(true)
    } catch (e) {
      message.error(shortError(e))
    }
  }
}

async function markAllRead() {
  if (!sms.value?.bus) return
  busy.value = true
  try {
    await smsMarkAllRead(sms.value.bus)
    message.success('已全部标记为已读')
    selected.value = null
    void reload()
  } catch (e) {
    message.error(shortError(e))
  } finally {
    busy.value = false
  }
}

async function removeOne(s: SmsItem) {
  if (!sms.value?.bus) return
  busy.value = true
  try {
    await smsRemove(sms.value.bus, s.name)
    message.success('短信已删除')
    selected.value = null
    void reload()
  } catch (e) {
    message.error(shortError(e))
  } finally {
    busy.value = false
  }
}

async function removeRead() {
  if (!sms.value?.bus) return
  busy.value = true
  try {
    await smsRemoveScope(sms.value.bus, 1)
    message.success('已删除全部已读短信')
    selected.value = null
    void reload()
  } catch (e) {
    message.error(shortError(e))
  } finally {
    busy.value = false
  }
}

/* ---------------- 发送 ---------------- */
const form = ref({ slot: 1, phone: '', body: '', sender: '' })
const showComposer = ref(false)
const sending = ref(false)

function reply() {
  const s = selected.value
  if (!s) return
  form.value = { slot: s.slot ?? slotOptions.value[0]?.value ?? 1, phone: s.phone, body: '', sender: '' }
  showComposer.value = true
}
function newSms() {
  form.value = { slot: slotOptions.value[0]?.value ?? 1, phone: '', body: '', sender: '' }
  showComposer.value = true
}
const charLimit = computed(() => {
  // 官方规则：含非 ASCII 字符时单条 70 字，否则 160 字
  return /[^\x00-\xff]/.test(form.value.body) ? 70 : 160
})
const smsParts = computed(() => (form.value.body ? Math.max(1, Math.ceil(form.value.body.length / charLimit.value)) : 0))

async function doSend() {
  const b = sms.value?.bus
  if (!b) {
    message.warning('没有可用的模组总线，短信不可用')
    return
  }
  if (!/^\d+$/.test(form.value.phone)) {
    message.warning('收件人号码只能是数字（含国家码时直接连写）')
    return
  }
  if (!form.value.body) {
    message.warning('短信内容不能为空')
    return
  }
  sending.value = true
  try {
    await smsSend({
      bus: b,
      slot: Number(form.value.slot) || 1,
      phone: form.value.phone,
      body: form.value.body,
      sender: form.value.sender || undefined,
    })
    message.success('短信已提交发送')
    form.value.body = ''
    showComposer.value = false
    tab.value = 'send'
    void reload()
  } catch (e) {
    message.error(shortError(e))
  } finally {
    sending.value = false
  }
}

function retryProbe() {
  clearCellularCache()
  void reload()
}
</script>

<template>
  <div class="nui-page">
    <PageState :loading="loading && !data" :error="data ? '' : error" :empty="!data" empty-text="没有读到短信数据" @retry="retryProbe">
      <template v-if="sms">
        <!-- 无模组：明确不可用 + 真实证据 -->
        <div v-if="!sms.supported" class="nui-grid">
          <PanelCard class="span-12" title="无蜂窝模组，短信不可用" action="重新探测" @action="retryProbe">
            <template #icon><n-icon><WarningOutline /></n-icon></template>
            <n-alert type="warning" :bordered="false" title="无蜂窝模组，短信不可用">
              <div class="reason">{{ sms.reason || '未检测到短信模组' }}</div>
              <p class="nui-small" style="margin: 6px 0 0">
                官方后台在此场景显示「未检测到短信模组」（i18n: sms.not_found_sms_modem），本页采用同一降级语义。
              </p>
              <p v-if="sms.error" class="nui-small" style="margin: 6px 0 0">接口返回：{{ sms.error }}</p>
              <p class="nui-small" style="margin: 6px 0 0">
                本机是纯路由型号（MT3600BE 无内置 4G/5G 模组），官方后台的短信页同样为空。
                插上 USB 蜂窝模组后本页会自动恢复为真实的收件箱/发件箱。
              </p>
            </n-alert>

            <div class="nui-sec" style="margin-top: 14px">诊断证据（真机实测）</div>
            <div class="evidence">
              <div v-for="(e, i) in sms.probe.evidence" :key="i" class="ev-row">
                <span class="ev-label">{{ e.label }}</span>
                <n-tag
                  size="small"
                  :bordered="false"
                  :type="e.tone === 'ok' ? 'success' : e.tone === 'warn' ? 'warning' : e.tone === 'err' ? 'error' : 'default'"
                  class="nui-mono"
                >
                  {{ e.value }}
                </n-tag>
              </div>
            </div>
          </PanelCard>

          <PanelCard class="span-12" title="短信功能会显示什么（有模组时）">
            <template #icon><n-icon><InformationCircleOutline /></n-icon></template>
            <ul class="reason-list">
              <li>收件箱 / 已发送两个列表：status 0=未读、1=已读、3/4=发送中、5=发送失败。</li>
              <li>查看详情时自动标记已读（官方 modem.set_sms status=1）；「全部已读」用 status=6。</li>
              <li>删除单条（remove_sms name+scope=10）、删除已读（scope=1）、删除收件（scope=12）。</li>
              <li>写短信：modem.send_sms(slot,bus,phone_number,body,timeout=0)，含国家码直接拼在号码前。</li>
              <li>驱动/内核支持蜂窝（option/qmi_wwan/cdc_wdm 已加载），只差模组硬件。</li>
            </ul>
            <p class="nui-small nui-muted" style="margin: 10px 0 0">
              本页没有伪造任何会话或短信内容：没有模组就只显示能力说明与证据。
            </p>
          </PanelCard>
        </div>

        <!-- 有模组：真实短信功能 -->
        <div v-else class="nui-grid">
          <PanelCard class="span-12" title="短信">
            <template #icon><n-icon><ChatbubbleEllipsesOutline /></n-icon></template>
            <template #extra>
              <div class="nui-row nui-wrap">
                <n-select
                  v-if="busOptions.length > 1"
                  v-model:value="bus"
                  :options="busOptions"
                  size="tiny"
                  style="width: 150px"
                  @update:value="reload()"
                />
                <n-tag size="small" :bordered="false" type="success">未读 {{ unread }}</n-tag>
                <n-button size="tiny" secondary :disabled="!unread" :loading="busy" @click="markAllRead">全部已读</n-button>
                <n-popconfirm @positive-click="removeRead">
                  <template #trigger>
                    <n-button size="tiny" secondary :disabled="!receiveList.length">删除已读</n-button>
                  </template>
                  删除收件箱中所有已读短信？此操作不可撤销。
                </n-popconfirm>
                <n-button size="tiny" type="primary" @click="newSms">
                  <template #icon><n-icon><SendOutline /></n-icon></template>
                  写短信
                </n-button>
                <span class="nui-small nui-muted">{{ updatedText }}</span>
              </div>
            </template>

            <div class="tabs">
              <a class="tab" :class="{ on: tab === 'receive' }" @click="tab = 'receive'">
                <n-icon><MailUnreadOutline /></n-icon> 收件箱
                <n-tag v-if="unread" size="tiny" type="error" :bordered="false">{{ unread }}</n-tag>
              </a>
              <a class="tab" :class="{ on: tab === 'send' }" @click="tab = 'send'">
                <n-icon><MailOpenOutline /></n-icon> 已发送
                <n-tag size="tiny" :bordered="false">{{ sendList.length }}</n-tag>
              </a>
              <span class="nui-right nui-small nui-muted">总线 {{ sms.bus }}</span>
            </div>

            <div class="sms-body">
              <div class="list">
                <div v-if="!curList.length" class="empty">
                  <n-icon :size="26"><MailOpenOutline /></n-icon>
                  <span class="nui-small nui-muted">{{ tab === 'receive' ? '收件箱为空' : '没有已发送短信' }}</span>
                </div>
                <div
                  v-for="(s, i) in curList"
                  :key="s.name || i"
                  class="item"
                  :class="{ on: selected?.name === s.name && selected?.date === s.date }"
                  @click="openItem(s)"
                >
                  <div class="item-top">
                    <i class="dot" :class="{ unread: s.unread, failed: s.failed, sending: s.sending }" />
                    <strong class="phone nui-mono">{{ s.phone || '未知号码' }}</strong>
                    <n-tag size="tiny" :bordered="false" :type="statusType(s)">{{ statusText(s) }}</n-tag>
                    <span class="date nui-small nui-muted">{{ fmtDate(s.date) }}</span>
                  </div>
                  <div class="preview nui-small">{{ s.body || '（空短信）' }}</div>
                </div>
              </div>

              <div class="detail">
                <div v-if="selected" class="detail-inner">
                  <div class="nui-between">
                    <div>
                      <div class="nui-mono" style="font-size: 16px; font-weight: 600">{{ selected.phone || '未知号码' }}</div>
                      <div class="nui-small nui-muted">
                        {{ fmtDate(selected.date) }} · {{ statusText(selected) }}
                        <template v-if="selected.slot"> · 卡槽 {{ selected.slot }}</template>
                      </div>
                    </div>
                    <div class="nui-row">
                      <n-button size="tiny" secondary @click="reply">回复</n-button>
                      <n-popconfirm @positive-click="removeOne(selected)">
                        <template #trigger>
                          <n-button size="tiny" secondary type="error">
                            <template #icon><n-icon><TrashOutline /></n-icon></template>
                            删除
                          </n-button>
                        </template>
                        删除这条短信？此操作不可撤销。
                      </n-popconfirm>
                    </div>
                  </div>
                  <pre class="body">{{ selected.body }}</pre>
                </div>
                <div v-else class="empty nui-small nui-muted">← 选择左侧短信查看详情</div>
              </div>
            </div>
          </PanelCard>

          <PanelCard v-if="showComposer" class="span-12" title="写短信">
            <template #icon><n-icon><SendOutline /></n-icon></template>
            <div class="composer">
              <n-select v-model:value="form.slot" :options="slotOptions" size="small" style="width: 160px" />
              <n-input v-model:value="form.phone" placeholder="收件人号码（含国家码直接连写）" size="small" style="max-width: 260px" />
              <n-input v-model:value="form.sender" placeholder="发送卡号码（可选）" size="small" style="max-width: 200px" />
            </div>
            <n-input
              v-model:value="form.body"
              type="textarea"
              :rows="4"
              placeholder="短信内容"
              style="margin-top: 10px"
            />
            <div class="nui-between" style="margin-top: 10px">
              <span class="nui-small nui-muted">
                {{ form.body.length }} 字 · 按当前字符集约 {{ smsParts }} 条（单条上限 {{ charLimit }} 字）
              </span>
              <div class="nui-row">
                <n-button size="small" @click="showComposer = false">取消</n-button>
                <n-button size="small" type="primary" :loading="sending" @click="doSend">发送</n-button>
              </div>
            </div>
            <p class="nui-small nui-muted" style="margin: 10px 0 0">
              发送走官方 modem.send_sms（真写）；失败信息来自固件业务错误码，不会伪装成功。
            </p>
          </PanelCard>
        </div>
      </template>
    </PageState>
  </div>
</template>

<style scoped>
.reason {
  font-size: 13px;
  margin-bottom: 6px;
}
.reason-list {
  margin: 0;
  padding-left: 18px;
  font-size: 12.5px;
  line-height: 1.9;
  opacity: 0.78;
}
.evidence {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ev-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 12.5px;
}
.ev-label {
  min-width: 220px;
  opacity: 0.6;
  flex: none;
}
.tabs {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 6px 2px 10px;
  border-bottom: 1px solid var(--line);
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  opacity: 0.6;
  cursor: pointer;
  padding-bottom: 4px;
  border-bottom: 2px solid transparent;
}
.tab.on {
  opacity: 1;
  color: var(--nui-accent);
  border-bottom-color: var(--nui-accent);
}
.sms-body {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  gap: 16px;
  margin-top: 12px;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 460px;
  overflow: auto;
}
.item {
  padding: 9px 10px;
  border-radius: 10px;
  cursor: pointer;
  border: 1px solid transparent;
}
.item:hover {
  background: rgba(128, 128, 128, 0.07);
}
.item.on {
  background: rgba(32, 128, 240, 0.08);
  border-color: rgba(32, 128, 240, 0.35);
}
.item-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.phone {
  font-size: 13px;
}
.date {
  margin-left: auto;
  flex: none;
}
.preview {
  margin-top: 4px;
  opacity: 0.72;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: transparent;
  flex: none;
}
.dot.unread {
  background: var(--err);
}
.dot.failed {
  background: var(--warn);
}
.dot.sending {
  background: var(--nui-accent);
}
.detail {
  border-left: 1px solid var(--line);
  padding-left: 16px;
  min-height: 240px;
}
.body {
  margin: 12px 0 0;
  padding: 12px;
  border-radius: 10px;
  background: rgba(128, 128, 128, 0.08);
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.75;
  font-family: inherit;
  max-height: 340px;
  overflow: auto;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 0;
  opacity: 0.55;
}
.composer {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
@media (max-width: 1000px) {
  .sms-body {
    grid-template-columns: 1fr;
  }
  .detail {
    border-left: 0;
    padding-left: 0;
    border-top: 1px solid var(--line);
    padding-top: 12px;
  }
}
</style>
