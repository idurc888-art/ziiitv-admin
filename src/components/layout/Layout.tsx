import React from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export function Layout() {
  return (
    <div className="flex h-screen w-full bg-base overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto w-full">
        <div className="min-h-full p-6 lg:p-8 max-w-[1600px] mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
