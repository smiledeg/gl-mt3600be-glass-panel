import { api } from '@/api'

/** 分段上传到路由器 /www/glass-media/，返回可直接访问的 URL */
async function uploadBlob(blob: Blob, ext: string, onProgress?: (pct: number) => void): Promise<string> {
  const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const begin = await api.call<{ ok: boolean; err?: string }>('glass', 'media_begin', { id })
  if (!begin?.ok) throw new Error(begin?.err || '无法创建上传文件')
  const chunk = 512 * 1024
  let sent = 0
  while (sent < blob.size) {
    const buf = new Uint8Array(await blob.slice(sent, sent + chunk).arrayBuffer())
    let bin = ''
    for (let i = 0; i < buf.length; i += 0x8000) {
      bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    }
    const r = await api.call<{ ok: boolean; err?: string }>('glass', 'media_chunk', { id, data: btoa(bin) })
    if (!r?.ok) throw new Error(r?.err || '上传中断')
    sent += buf.length
    onProgress?.(Math.min(99, Math.round((sent / blob.size) * 100)))
  }
  const fin = await api.call<{ ok: boolean; url?: string; err?: string }>('glass', 'media_finish', { id, ext })
  if (!fin?.ok || !fin.url) throw new Error(fin?.err || '保存失败')
  onProgress?.(100)
  return fin.url
}

/** 视频背景：MP4/WebM 直接上传 */
export async function uploadVideo(file: File, onProgress?: (pct: number) => void): Promise<string> {
  const rawExt = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '')
  const ext = ['mp4', 'webm', 'm4v', 'mov', 'ogv'].includes(rawExt) ? rawExt : 'mp4'
  return uploadBlob(file, ext, onProgress)
}

/** 壁纸：浏览器里压成 JPEG（长边 ≤2560）后上传，跨设备同步靠这个 URL */
export async function uploadImage(file: File, onProgress?: (pct: number) => void): Promise<string> {
  const blob = await compressImageBlob(file)
  return uploadBlob(blob, 'jpg', onProgress)
}

/** 把旧的 localStorage dataURL 壁纸迁移成设备文件 */
export async function uploadDataUrl(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob()
  return uploadBlob(blob, 'jpg')
}

function compressImageBlob(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      try {
        const max = 2560
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const cv = document.createElement('canvas')
        cv.width = w
        cv.height = h
        const ctx = cv.getContext('2d')
        if (!ctx) throw new Error('canvas 不可用')
        ctx.drawImage(img, 0, 0, w, h)
        cv.toBlob((b) => (b ? resolve(b) : reject(new Error('图片压缩失败'))), 'image/jpeg', 0.85)
      } catch (e) {
        reject(e)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('不是有效的图片文件'))
    }
    img.src = url
  })
}
