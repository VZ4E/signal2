// src/app/layout.tsx
import type { Metadata } from 'next'
export const metadata: Metadata = { title: 'Respawn Signal', description: 'Brand Deal Scanner' }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#07080d', color: '#e8eaf6', fontFamily: 'sans-serif' }}>
        {children}
      </body>
    </html>
  )
}
