export function toCSV<T extends Record<string, unknown>>(rows: T[], columns: { key: keyof T; header: string }[]): string {
  const header = columns.map((c) => `"${c.header}"`).join(',')
  const body = rows
    .map((row) =>
      columns
        .map((c) => {
          const val = row[c.key]
          if (val === null || val === undefined) return ''
          const str = String(val).replace(/"/g, '""')
          return `"${str}"`
        })
        .join(',')
    )
    .join('\n')
  return `${header}\n${body}`
}

export function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
