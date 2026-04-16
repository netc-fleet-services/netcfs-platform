import React from 'react'

interface CardProps {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

export function Card({ children, className = '', style }: CardProps) {
  return (
    <div
      className={`bg-surface-container border-outline ${className}`}
      style={{
        border: '1px solid var(--outline)',
        borderRadius: '0.75rem',
        padding: '1.25rem',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function CardHeader({ children, className = '' }: CardProps) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '1rem',
      }}
    >
      {children}
    </div>
  )
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        margin: 0,
        fontSize: '0.9375rem',
        fontWeight: 700,
        color: 'var(--on-surface)',
      }}
    >
      {children}
    </h3>
  )
}
