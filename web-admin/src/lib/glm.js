/**
 * GLM 通道（智能录单 AI）—— v2：走云函数 ai 代理
 * 密钥配置在云函数环境变量（服务端，多租户安全），浏览器不再持有 Key；
 * 本文件保持原导出面（getGlmKey 等），供智能录单页的引擎提示与回退逻辑使用。
 * 文本识别失败时页面会自动回退本地规则解析器（lib/orderParse）。
 */
import { callFn } from '@/lib/cloudbase'

export const getGlmKey = () => 'server-managed'
export const setGlmKey = () => {}
export const getTextModel = () => 'GLM（云函数代理）'
export const setTextModel = () => {}
export const getImageModel = () => 'GLM 视觉（云函数代理）'
export const setImageModel = () => {}

/** 图片压缩：最长边 ≤1600px、JPEG 0.82（上传端压缩，控制云函数载荷） */
export function compressImage(file, max = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败'))
    }
    img.src = url
  })
}

async function callAi(payload) {
  const res = await callFn('ai', payload)
  const r = res?.result ?? res
  if (!r || r.ok === false) throw new Error((r && r.error) || 'AI 解析失败')
  return r
}

export async function glmParseText(text) {
  const r = await callAi({ mode: 'text', text: String(text || '') })
  return {
    customer_hint: r.customer_hint ?? null,
    delivery_date_hint: r.delivery_date_hint ?? null,
    items: r.items || [],
  }
}

export async function glmParseImage(dataUrl) {
  const r = await callAi({ mode: 'image', imageBase64: dataUrl })
  return {
    customer_hint: r.customer_hint ?? null,
    delivery_date_hint: r.delivery_date_hint ?? null,
    items: r.items || [],
  }
}
