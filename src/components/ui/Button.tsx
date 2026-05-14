import React from 'react'
import { classNames } from '../../lib/utils'
import { Loader2 } from 'lucide-react'

type ButtonVariant = 'primary' | 'ghost' | 'danger'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent hover:bg-accent-hover text-white border-transparent',
  ghost:   'bg-transparent hover:bg-elevated text-text-secondary hover:text-text-primary border-border',
  danger:  'bg-danger/10 hover:bg-danger/20 text-danger border-danger/30',
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: React.ReactNode
}

export function Button({
  children, variant = 'primary', size = 'md', loading = false,
  icon, className, disabled, ...props
}: ButtonProps) {
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-6 py-2.5 text-base' }
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={classNames(
        'inline-flex items-center gap-2 rounded-lg border font-medium transition-all duration-150',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className
      )}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}
