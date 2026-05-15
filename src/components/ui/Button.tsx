import React from 'react'
import { classNames } from '../../lib/utils'
import { Loader2 } from 'lucide-react'

type ButtonVariant = 'primary' | 'aqua' | 'neon' | 'ghost' | 'danger'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent hover:bg-accent-hover text-white',
  aqua:    'bg-aqua   hover:bg-aqua-hover  text-base',
  neon:    'bg-neon   hover:bg-neon-hover  text-base',
  ghost:   'bg-transparent hover:bg-white/[0.06] text-text-secondary hover:text-text-primary',
  danger:  'bg-danger/10 hover:bg-danger/20 text-danger',
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
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  }
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={classNames(
        'inline-flex items-center gap-2 rounded-[10px] font-semibold tracking-tight transition-all duration-150 active:scale-[0.98]',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100',
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
