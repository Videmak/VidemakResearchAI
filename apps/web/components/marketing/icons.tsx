import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, strokeWidth = 1.8, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const CheckIcon = (p: IconProps) => <Svg strokeWidth={2.6} {...p}><path d="M20 6 9 17l-5-5" /></Svg>;
export const DashIcon = (p: IconProps) => <Svg strokeWidth={2} {...p}><path d="M7 12h10" /></Svg>;
export const PlayIcon = (p: IconProps) => <Svg {...p}><path d="M5.5 3v18L21 12z" fill="currentColor" stroke="none" /></Svg>;
export const BoltIcon = (p: IconProps) => <Svg {...p}><path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" stroke="none" /></Svg>;
export const MenuIcon = (p: IconProps) => <Svg strokeWidth={2} {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>;
export const CloseIcon = (p: IconProps) => <Svg strokeWidth={2} {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>;
export const ChevronDownIcon = (p: IconProps) => <Svg strokeWidth={2} {...p}><path d="m6 9 6 6 6-6" /></Svg>;
export const TabIcon = (p: IconProps) => <Svg strokeWidth={2} {...p}><path d="M3 12h13M11 7l5 5-5 5M20 5v14" /></Svg>;
export const AtIcon = (p: IconProps) => (
  <Svg strokeWidth={2} {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.9 7.9" />
  </Svg>
);
export const ChatIcon = (p: IconProps) => <Svg {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></Svg>;
export const ShieldIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);
export const PhoneIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="2" width="12" height="20" rx="2.5" />
    <path d="M11 18h2" />
  </Svg>
);
