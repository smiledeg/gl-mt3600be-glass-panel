import { onBeforeUnmount, onMounted, watch } from 'vue'
import { api } from '@/api'
import { uploadDataUrl } from '@/api/media'
import { useUiStore, type Appearance } from '@/stores/ui'

interface StoredAppearance {
  version?: number
  mode?: 'auto' | 'dark' | 'light'
  appearance?: Appearance
}

/**
 * 外观设置跨设备同步：
 *  - 设备端 /etc/glass-appearance.json 是唯一真源，手机/电脑打开面板都会拉取并应用；
 *  - 本地修改后 400ms 防抖写回设备；
 *  - 旧的 localStorage dataURL 壁纸会在首次同步时自动上传成 /glass-media 文件。
 */
export function useAppearanceSync() {
  const ui = useUiStore()
  let ready = false
  let timer: number | undefined
  let applying = false

  async function pull(): Promise<boolean> {
    try {
      const r = await api.call<{ ok: boolean; raw: string }>('glass', 'appearance_get')
      const raw = String(r?.raw || '')
      if (!raw) return false
      const data = JSON.parse(raw) as StoredAppearance
      applying = true
      if (data.appearance) ui.setAppearance(data.appearance)
      if (data.mode) ui.setMode(data.mode)
      applying = false
      return true
    } catch {
      applying = false
      return false
    }
  }

  async function push() {
    try {
      const payload: StoredAppearance = { version: 1, mode: ui.mode, appearance: ui.appearance }
      await api.call('glass', 'appearance_set', { raw: JSON.stringify(payload) })
    } catch {
      /* 设备不可达时保持本地设置 */
    }
  }

  async function init() {
    const pulled = await pull()
    if (!pulled) {
      // 设备上还没有已保存设置：把本地设置作为初始值推上去
      if (ui.appearance.wallpaper.startsWith('data:')) {
        try {
          const url = await uploadDataUrl(ui.appearance.wallpaper)
          ui.setAppearance({ wallpaper: url })
        } catch {
          /* 迁移失败就用原值，至少本机可用 */
        }
      }
      await push()
    }
    ready = true
  }

  watch(
    [() => ui.appearance, () => ui.mode],
    () => {
      if (!ready || applying) return
      if (timer) clearTimeout(timer)
      timer = window.setTimeout(() => void push(), 400)
    },
    { deep: true },
  )

  function onVisible() {
    if (document.visibilityState === 'visible') void pull()
  }

  onMounted(() => {
    void init()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
  })
  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', onVisible)
  })
}
