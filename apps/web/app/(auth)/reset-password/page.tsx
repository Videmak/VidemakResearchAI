import { ResetPasswordForm } from '@/components/auth/PasswordReset';
import { pageMetadata } from '@/components/marketing/seo';

export const metadata = pageMetadata({ title: 'Choose a new password', path: '/reset-password', description: 'Choose a new password for your Videmak account.', index: false });

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
