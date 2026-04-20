import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'NETC Apps Portal',
  description: 'Internal operations platform for NETC Fleet Services',
  icons: { icon: '/favicon.ico' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="theme-midnight">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&family=Material+Symbols+Outlined&display=swap"
          rel="stylesheet"
        />
        {/* No-flash theme script */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='daylight'){document.documentElement.className='theme-daylight';}else{document.documentElement.className='theme-midnight';}}catch(e){}})()`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
