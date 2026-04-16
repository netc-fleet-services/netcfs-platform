'use client'

import React from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export function Input({ label, error, id, className = '', ...props }: InputProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      {label && (
        <label htmlFor={id} className="form-label">
          {label}
        </label>
      )}
      <input id={id} className={`form-input ${className}`} {...props} />
      {error && <span style={{ fontSize: '0.75rem', color: 'var(--error)' }}>{error}</span>}
    </div>
  )
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  children: React.ReactNode
}

export function Select({ label, id, children, className = '', ...props }: SelectProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      {label && (
        <label htmlFor={id} className="form-label">
          {label}
        </label>
      )}
      <select id={id} className={`form-select ${className}`} {...props}>
        {children}
      </select>
    </div>
  )
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
}

export function Textarea({ label, id, className = '', ...props }: TextareaProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      {label && (
        <label htmlFor={id} className="form-label">
          {label}
        </label>
      )}
      <textarea id={id} className={`form-textarea ${className}`} {...props} />
    </div>
  )
}
