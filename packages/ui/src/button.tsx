'use client'

import React from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  children: React.ReactNode
}

const variantClass: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
}

const sizeStyle: Record<Size, React.CSSProperties> = {
  sm: { padding: '0.25rem 0.75rem', fontSize: '0.75rem' },
  md: {},
  lg: { padding: '0.625rem 1.5rem', fontSize: '1rem' },
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  style,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={variantClass[variant]}
      disabled={disabled || loading}
      style={{ ...sizeStyle[size], ...style }}
      {...props}
    >
      {loading && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ animation: 'spin 0.8s linear infinite' }}
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      )}
      {children}
    </button>
  )
}
