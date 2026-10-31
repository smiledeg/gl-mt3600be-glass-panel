<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NCheckbox, NIcon, NInput, useMessage } from 'naive-ui'
import { KeyOutline, PersonOutline } from '@vicons/ionicons5'
import { useAuthStore } from '@/stores/auth'
import { isDemo } from '@/api'
import { luciEntryUrl } from '@/utils/luci'
import { officialUrl } from '@/utils/official'
import { forgetRemembered, loadRemembered, rememberEnabled, saveRemembered } from '@/utils/remember'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const message = useMessage()

const username = ref('root')
const password = ref('')
const showErr = ref('')
/** 会话过期被踢回登录页时给个明确提示（而不是让用户以为密码错了） */
const expired = ref(route.query.expired === '1' || auth.expired)
const pwdRef = ref<InstanceType<typeof NInput> | null>(null)
const remember = ref(rememberEnabled())
const remembered = ref(false)

if (isDemo) password.value = 'demo'

onMounted(() => {
  const c = loadRemembered()
  if (c) {
    username.value = c.username
    password.value = c.password
    remember.value = true
    remembered.value = true
  }
  if (expired.value) pwdRef.value?.focus()
})

async function submit() {
  showErr.value = ''
  if (!password.value) {
    showErr.value = '请输入后台密码'
    return
  }
  try {
    await auth.login(username.value, password.value)
    expired.value = false
    if (remember.value) {
      saveRemembered({ username: username.value, password: password.value })
      remembered.value = true
    } else {
      forgetRemembered()
      remembered.value = false
    }
    message.success('登录成功')
    router.replace((route.query.next as string) || '/overview')
  } catch (e: unknown) {
    showErr.value = e instanceof Error ? e.message : '登录失败'
  }
}
</script>

<template>
  <div class="wrap">
    <div class="card">
      <div class="logo">
        <svg viewBox="0 0 32 32" width="34" height="34">
          <defs>
            <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
              <stop stop-color="#38bdf8" />
              <stop offset="1" stop-color="#2080f0" />
            </linearGradient>
          </defs>
          <rect width="32" height="32" rx="9" fill="url(#lg)" />
          <path d="M9 20.5c4-8 10-8 14 0" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" />
          <circle cx="16" cy="23" r="2.2" fill="#fff" />
        </svg>
      </div>

      <div class="name">GL-MT3600BE</div>
      <div class="sub">Beryl 7 · 管理后台</div>

      <div class="form">
        <n-input v-model:value="username" placeholder="用户名" :disabled="auth.busy" @keyup.enter="submit">
          <template #prefix><n-icon><PersonOutline /></n-icon></template>
        </n-input>
        <n-input
          ref="pwdRef"
          v-model:value="password"
          type="password"
          show-password-on="click"
          placeholder="后台密码"
          :disabled="auth.busy"
          @keyup.enter="submit"
        >
          <template #prefix><n-icon><KeyOutline /></n-icon></template>
        </n-input>
        <div class="remember-row">
          <n-checkbox v-model:checked="remember">记住我（此设备）</n-checkbox>
          <n-button v-if="remembered" size="tiny" quaternary @click="forgetRemembered(); remembered = false; remember = false; message.success('已清除本机记住的密码')">清除</n-button>
        </div>
        <p class="remember-tip">勾选后会在本机浏览器保存账号密码并自动填充；公共设备请勿勾选。</p>
        <p v-if="expired && !showErr" class="expired-tip">登录已过期（会话超时或已在其它设备登录），请重新登录。</p>
        <p v-if="showErr" class="err">{{ showErr }}</p>
        <n-button type="primary" block :loading="auth.busy" @click="submit">登 录</n-button>
        <p class="tip">{{ isDemo ? '演示模式，直接回车进入' : '与 GL 官方后台共用同一套账号密码' }}</p>
      </div>

      <div class="foot">
        <a :href="officialUrl()" target="_blank" rel="noreferrer">使用原厂界面</a>
        <span>·</span>
        <a :href="luciEntryUrl()" target="_blank" rel="noreferrer">LuCI</a>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: 24px;
  background: var(--bg);
}
.card {
  width: min(360px, 92vw);
  padding: 28px 24px 20px;
  border-radius: 14px;
  background: var(--card);
  border: 1px solid var(--line);
  box-shadow: 0 12px 40px -24px rgba(0, 0, 0, 0.45);
  text-align: center;
}
.logo {
  display: grid;
  place-items: center;
  margin-bottom: 12px;
  filter: drop-shadow(0 6px 16px rgba(32, 128, 240, 0.45));
}
.name {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.3px;
}
.sub {
  font-size: 12px;
  opacity: 0.55;
  margin: 2px 0 20px;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.expired-tip {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--warn);
  text-align: left;
}
.err {
  margin: 0;
  font-size: 12px;
  color: var(--err);
  text-align: left;
}
.tip {
  margin: 0;
  font-size: 11.5px;
  opacity: 0.5;
}
.foot {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
  display: flex;
  gap: 8px;
  justify-content: center;
  font-size: 12px;
  opacity: 0.6;
}
.foot a:hover {
  color: var(--nui-accent);
  opacity: 1;
}

.remember-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 2px;
}
.remember-tip {
  margin: -4px 0 0;
  font-size: 11px;
  line-height: 1.5;
  opacity: 0.5;
  text-align: left;
}
</style>
