import { redirect } from 'next/navigation';

/** AI Chat opens as a panel beside the documents; old links land there. */
export default function Page() {
  redirect('/editor?tool=chat');
}
