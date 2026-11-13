import type { Metadata } from 'next';
import Link from 'next/link';
import { LuMail, LuMapPin, LuPhoneCall } from 'react-icons/lu';
import { SUPPORT_EMAIL } from '@/components/classic/links';

/** The old site's Contact Us page: where we are, how to email and how to call. */

export const metadata: Metadata = {
  title: { absolute: 'Contact Us - Videmak Research AI' },
  alternates: { canonical: 'https://videmak.net/contact' },
};

const ADDRESS = process.env.NEXT_PUBLIC_COMPANY_ADDRESS || '';
const PHONE = process.env.NEXT_PUBLIC_COMPANY_PHONE || '';
const EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || SUPPORT_EMAIL;

export default function ContactPage() {
  const cards = [
    { icon: LuMapPin, title: 'Our Location', text: 'Visit us at our local office. We would love to get to know in person.', detail: ADDRESS && <span>{ADDRESS}</span> },
    { icon: LuMail, title: 'Email Us', text: 'Drop us an email and you will receive a reply within a short time.', detail: <a href={`mailto:${EMAIL}`} rel="nofollow" className="hover:text-[#0d6efd]">{EMAIL}</a> },
    { icon: LuPhoneCall, title: 'Call Us', text: 'Give us a call. Our Experts are ready to talk to you.', detail: PHONE && <a href={`tel:${PHONE.replace(/[^+\d]/g, '')}`} rel="nofollow" className="hover:text-[#0d6efd]">{PHONE}</a> },
  ];
  return (
    <>
      <div className="bg-[#f8fafc] px-4 pb-12 pt-36 text-center">
        <p className="text-[12px]"><Link href="/" className="text-[#0d6efd]">Home</Link> / <span className="text-[#6b7280]">Contact Us</span></p>
        <h1 className="mb-2 mt-2 text-[30px] font-bold text-[#1e1e2d]">Contact Us</h1>
        <p className="text-[13px] text-[#6b7280]">We are always here right by your side</p>
      </div>
      <ul className="mx-auto grid max-w-[1140px] gap-6 px-4 py-16 md:grid-cols-3">
        {cards.map(({ icon: Icon, title, text, detail }) => (
          <li key={title} className="rounded-lg border border-[#e5e7eb] bg-white p-8 text-center">
            <Icon className="mx-auto mb-4 size-7 text-[#0d6efd]" aria-hidden="true" />
            <h2 className="mb-2 text-[16px] font-bold text-[#1e1e2d]">{title}</h2>
            <p className="text-[14px] text-[#4b5563]">{text}</p>
            {detail && <p className="mt-3 break-words text-[13px] text-[#6b7280]">{detail}</p>}
          </li>
        ))}
      </ul>
    </>
  );
}
