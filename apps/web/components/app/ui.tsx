/** Shared app UI pieces, styled from the approved mockups (source/base.css). */
import Link from 'next/link';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg' };

const variants = {
  primary: 'bg-brand text-white shadow-brand hover:bg-brand-600 disabled:bg-subtle disabled:shadow-none',
  secondary: 'border border-line bg-white text-ink hover:bg-soft disabled:text-subtle',
  ghost: 'text-ink-2 hover:bg-soft',
  danger: 'border border-line bg-white text-red-600 hover:bg-red-50',
};
const sizes = { sm: 'h-9 px-3 text-[13.5px] rounded-[10px]', md: 'h-[42px] px-[18px] text-[15px] rounded-[11px]', lg: 'h-[52px] px-6 text-[16.5px] rounded-[13px]' };

export function Button({ variant = 'secondary', size = 'md', className = '', ...props }: ButtonProps) {
  return <button type="button" className={`inline-flex shrink-0 items-center justify-center gap-2 font-semibold transition-colors disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`} {...props} />;
}

export function ButtonLink({ href, variant = 'secondary', size = 'md', className = '', children }: { href: string; variant?: ButtonProps['variant']; size?: ButtonProps['size']; className?: string; children: React.ReactNode }) {
  return <Link href={href} className={`inline-flex shrink-0 items-center justify-center gap-2 font-semibold transition-colors ${variants[variant]} ${sizes[size]} ${className}`}>{children}</Link>;
}

export function Card({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <section className={`rounded-2xl border border-line bg-white ${className}`}>{children}</section>;
}

export function CardHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-3 border-b border-line-2 px-5 py-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-[17px] font-bold tracking-[-0.01em]">{title}</h2>
        {description && <p className="mt-1 text-[14px] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Small tag like the mockups' "Open access" / "Highly cited" chips. */
export function StatusPill({ tone = 'neutral', children }: { tone?: 'positive' | 'neutral' | 'warning' | 'negative' | 'brand'; children: React.ReactNode }) {
  const style = {
    positive: 'bg-green-100 text-green-800',
    neutral: 'bg-line-2 text-ink-2',
    warning: 'bg-amber-50 text-amber-800',
    negative: 'bg-red-50 text-red-700',
    brand: 'bg-brand-50 text-brand-600',
  }[tone];
  return <span className={`inline-flex h-[22px] shrink-0 items-center rounded-md px-2 text-[11.5px] font-semibold ${style}`}>{children}</span>;
}

/** The mockups' segmented control (grey track, white active pill). */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-xl bg-line-2 p-1">
      {options.map((option) => (
        <button key={option.value} role="tab" type="button" aria-selected={option.value === value} onClick={() => onChange(option.value)}
          className={`h-9 shrink-0 whitespace-nowrap rounded-[9px] px-3.5 text-[14px] font-semibold transition-colors ${option.value === value ? 'bg-white text-ink shadow-[0_1px_3px_rgba(15,23,42,.12)]' : 'text-muted'}`}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Chips like the mockups' filter chips (blue tint when on). */
export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-full border px-[11px] text-[13px] font-medium ${active ? 'border-brand-100 bg-brand-50 text-brand-600' : 'border-line bg-white text-ink-2'}`}>
      {children}
    </button>
  );
}

export const inputClass = 'h-11 w-full rounded-xl border border-line bg-white px-3.5 text-[15px] text-ink placeholder:text-subtle focus:border-brand focus:shadow-[0_0_0_4px_var(--color-brand-50)] focus:outline-none';

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <p className="text-[16px] font-semibold">{title}</p>
      {children && <p className="mt-1 max-w-sm text-[14px] leading-relaxed text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
