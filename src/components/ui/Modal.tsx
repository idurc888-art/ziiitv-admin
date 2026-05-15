import React, { useEffect } from 'react'
import { classNames } from '../../lib/utils'
import { X } from 'lucide-react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  className?: string
}

export function Modal({ isOpen, onClose, title, children, className }: ModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        className="absolute inset-0 bg-base/70 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      <div className={classNames(
        'relative bg-surface rounded-[20px] shadow-2xl w-full max-w-[460px] overflow-hidden',
        className
      )}>
        <div className="flex items-center justify-between pt-5 pb-3 px-6">
          <h3 className="text-xl font-display font-bold text-text-primary tracking-[-0.025em]">{title}</h3>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors p-1.5 rounded-lg hover:bg-elevated"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pb-6">
          {children}
        </div>
      </div>
    </div>
  )
}
