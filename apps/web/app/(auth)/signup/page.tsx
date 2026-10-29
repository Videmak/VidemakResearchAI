import { AuthEntry } from '@/components/auth/AuthEntry';
import { pageMetadata } from '@/components/marketing/seo';

export const metadata = pageMetadata({
  title: 'Sign up',
  path: '/signup',
  description:
    'Create your free Videmak account: the full AI editor for academic writing, with citations from 250M+ real papers. No credit card needed.',
});

export default function SignupPage() {
  return <AuthEntry />;
}
