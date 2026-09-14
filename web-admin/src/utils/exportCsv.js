// CSV 导出工具：BOM + 转义，Excel 直接打开不乱码
export function exportCsv(filename, headers, rows) {
  const esc = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const content = '\ufeff' + [headers.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export function todayTag() {
  return new Date().toISOString().slice(0, 10)
}
