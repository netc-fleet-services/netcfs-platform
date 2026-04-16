import React from 'react'

interface Column<T> {
  key: string
  header: string
  render?: (row: T) => React.ReactNode
  mobileLabel?: string
}

interface TableProps<T extends Record<string, unknown>> {
  columns: Column<T>[]
  rows: T[]
  keyField?: string
  emptyMessage?: string
}

export function Table<T extends Record<string, unknown>>({
  columns,
  rows,
  keyField = 'id',
  emptyMessage = 'No data',
}: TableProps<T>) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="fleet-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                style={{ textAlign: 'center', color: 'var(--on-surface-muted)', padding: '2rem' }}
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={String(row[keyField])}>
                {columns.map((col) => (
                  <td key={col.key} data-label={col.mobileLabel ?? col.header}>
                    {col.render ? col.render(row) : String(row[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
