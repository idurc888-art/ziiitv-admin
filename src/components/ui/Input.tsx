import React from 'react'
import { classNames } from '../../lib/utils'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  icon?: React.ReactNode
}

export function Input({ label, error, icon, className, id, ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s/g, '-')
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-text-secondary">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
            {icon}
          </div>
        )}
        <input
          id={inputId}
          {...props}
          className={classNames(
            'w-full bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary',
            'placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors',
            icon && 'pl-9',
            error && 'border-danger focus:border-danger',
            className
          )}
        />
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}
