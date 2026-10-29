import { AuthEntry } from '@/components/auth/AuthEntry';
import { pageMetadata } from '@/components/marketing/seo';

export const metadata = pageMetadata({
  title: 'Sign in',
  path: '/login',
  description: 'Sign in to Videmak, the AI editor for academic writing.',
});

export default function LoginPage() {
  return <AuthEntry />;
}
