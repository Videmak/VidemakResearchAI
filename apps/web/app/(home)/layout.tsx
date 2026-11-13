import { Poppins } from 'next/font/google';
import { cookies } from 'next/headers';
import { ClassicFooter, ClassicMenu, SupportWidget } from '@/components/classic/ClassicParts';

const poppins = Poppins({ subsets: ['latin'], weight: ['300', '400', '500', '600', '700', '800', '900'], display: 'swap' });

/** The classic videmak.net pages: home, legal pages and contact, in the old site's look. */
export default async function ClassicLayout({ children }: { children: React.ReactNode }) {
  const signedIn = (await cookies()).get('videmak_signed_in')?.value === '1';
  return (
    <div className={`${poppins.className} relative flex min-h-dvh flex-col bg-white text-[#1e1e2d]`}>
      <a href="#main" className="sr-only z-50 rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
      {/* The menu floats over the page top, as the old site's did. */}
      <div className="absolute inset-x-0 top-0 z-[60]"><ClassicMenu signedIn={signedIn} /></div>
      <main id="main" className="flex-1">{children}</main>
      <ClassicFooter />
      <SupportWidget />
    </div>
  );
}
