<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import {
  NButton,
  NForm,
  NFormItemGi,
  NGrid,
  NInput,
  NInputNumber,
  NSelect,
  NSpin,
  NSwitch,
  useMessage,
} from 'naive-ui'

export interface Field {
  key: string
  label: string
  type?: 'text' | 'password' | 'number' | 'switch' | 'select' | 'textarea'
  options?: { label: string; value: string | number }[]
  min?: number
  max?: number
  step?: number
  placeholder?: string
  hint?: string
  /** 占几列（24 栅格） */
  span?: number
  rows?: number
}

const props = withDefaults(
  defineProps<{
    fields: Field[]
    load: () => Promise<Record<string, unknown>>
    save: (v: Record<string, unknown>) => Promise<void>
    submitText?: string
  }>(),
  { submitText: '保存' },
)

const message = useMessage()
const form = reactive<Record<string, unknown>>({})
const loading = ref(true)
const saving = ref(false)
const err = ref('')

async function load() {
  loading.value = true
  err.value = ''
  try {
    const v = await props.load()
    for (const f of props.fields) {
      const raw = v?.[f.key]
      form[f.key] = f.type === 'switch' ? !!raw : (raw ?? (f.type === 'number' ? 0 : ''))
    }
  } catch (e) {
    err.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function submit() {
  saving.value = true
  try {
    await props.save({ ...form })
    message.success('已保存')
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(load)
watch(() => props.fields, load)
</script>

<template>
  <n-spin :show="loading">
    <div v-if="err" class="err">{{ err }}</div>
    <n-form v-else label-placement="top" :show-feedback="false">
      <n-grid :cols="24" :x-gap="14" :y-gap="12" responsive="screen" item-responsive>
        <n-form-item-gi
          v-for="f in fields"
          :key="f.key"
          :span="`${f.span ?? 12} s:${f.span ?? 24} m:${f.span ?? 12}`"
          :label="f.label"
        >
          <n-switch v-if="f.type === 'switch'" v-model:value="form[f.key] as boolean" />
          <n-input-number
            v-else-if="f.type === 'number'"
            v-model:value="form[f.key] as number"
            :min="f.min"
            :max="f.max"
            :step="f.step ?? 1"
            style="width: 100%"
          />
          <n-select
            v-else-if="f.type === 'select'"
            v-model:value="form[f.key] as string"
            :options="f.options ?? []"
          />
          <n-input
            v-else-if="f.type === 'textarea'"
            v-model:value="form[f.key] as string"
            type="textarea"
            :rows="f.rows ?? 4"
            :placeholder="f.placeholder"
          />
          <n-input
            v-else
            v-model:value="form[f.key] as string"
            :type="f.type === 'password' ? 'password' : 'text'"
            :show-password-on="f.type === 'password' ? 'click' : undefined"
            :placeholder="f.placeholder"
          />
          <div v-if="f.hint" class="hint">{{ f.hint }}</div>
        </n-form-item-gi>
        <n-form-item-gi :span="24">
          <n-button type="primary" :loading="saving" @click="submit">{{ submitText }}</n-button>
        </n-form-item-gi>
      </n-grid>
    </n-form>
  </n-spin>
</template>

<style scoped>
.err {
  color: var(--err);
  font-size: 12px;
  padding: 6px 0;
}
.hint {
  font-size: 11px;
  opacity: 0.5;
  margin-top: 4px;
  width: 100%;
}
</style>
