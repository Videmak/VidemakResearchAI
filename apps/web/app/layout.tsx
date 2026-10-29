import type { Metadata, Viewport } from 'next';
import { Inter, Source_Serif_4 } from 'next/font/google';
import './globals.css';
import { PricingDialog } from '@/components/billing/PricingDialog';
import { PasskeyPrompt } from '@/components/auth/PasskeyPrompt';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const serif = Source_Serif_4({ subsets: ['latin'], variable: '--font-serif', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://videmak.net'),
  title: { default: 'Videmak — the AI editor for academic writing', template: '%s · Videmak' },
  description:
    'Write your paper faster, with citations you can trust. Autocomplete with real references, 250M+ papers, AI review, Word and LaTeX export.',
  applicationName: 'Videmak',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#2563eb',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${serif.variable}`}>
      <body>
        {children}
        <PricingDialog />
        <PasskeyPrompt />
      </body>
    </html>
  );
}
