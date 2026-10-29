import { ForgotPasswordForm } from '@/components/auth/PasswordReset';
import { pageMetadata } from '@/components/marketing/seo';

export const metadata = pageMetadata({
  title: 'Reset your password',
  path: '/forgot-password',
  description: 'Get a link to choose a new password for your Videmak account.',
  index: false,
});

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
