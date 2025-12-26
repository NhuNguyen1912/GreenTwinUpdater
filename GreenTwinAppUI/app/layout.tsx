import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'
import { AuthProvider } from "@/components/auth-provider"
import Chatbot from "@/components/chatbot";
import { ThemeProvider } from "@/components/theme-provider";
import { Inter } from "next/font/google";

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });
const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'Smart Campus - GreenTwin',
  description: 'Smart building management system for university classrooms with Azure Digital Twins',
  generator: 'GreenTwin Smart Building System',
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
  },
  icons: {
    icon: [
      {
        url: '/logo GreenTwin.jpg',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/logo GreenTwin.jpg',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/logo GreenTwin.jpg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/logo GreenTwin.jpg',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className={inter.className}>
        {/* 2. BỌC AUTH PROVIDER Ở NGOÀI CÙNG (hoặc ngay trong body) */}
        <AuthProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            {children}
            <Chatbot />
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
