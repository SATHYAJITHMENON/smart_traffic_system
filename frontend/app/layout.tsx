import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Navbar from './components/Navbar'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Traffic AI Dashboard',
  description: 'Smart Traffic Management System',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} min-h-screen bg-slate-900 text-slate-50`}>
        <Navbar />
        <main className="pt-20 p-6 min-h-screen">
          {children}
        </main>
      </body>
    </html>
  )
}
