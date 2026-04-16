'use client'

import React, { useEffect } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  maxWidth?: string
  children: React.ReactNode
}

export function Modal({ open, onClose, title, maxWidth = '480px', children }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-box"
        style={{ maxWidth }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '1.25rem',
            }}
          >
            <h2 style={{ margin: 0, fontSize: '1.0625rem', fontWeight: 700, color: 'var(--on-surface)' }}>
              {title}
            </h2>
            <button
              onClick={onClose}
              className="btn-ghost"
              style={{ padding: '0.25rem 0.5rem', fontSize: '1rem', lineHeight: 1 }}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
}

export function Drawer({ open, onClose, title, children }: DrawerProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer-panel">
        <div className="drawer-header">
          <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--on-surface)' }}>
            {title}
          </span>
          <button onClick={onClose} className="btn-ghost" aria-label="Close">✕</button>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </>
  )
}
