import { redirect } from 'next/navigation';

/** Find papers opens as a panel beside the documents; old links land there. */
export default function Page() {
  redirect('/editor?tool=papers');
}
