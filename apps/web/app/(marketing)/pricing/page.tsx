import { CheckIcon, DashIcon } from '@/components/marketing/icons';
import { comparisonRows, loadPublicPlans, pricingSummary, type CompareValue } from '@/components/marketing/plans';
import { PricingPlans } from '@/components/marketing/PricingPlans';
import { pageMetadata } from '@/components/marketing/seo';
import { container } from '@/components/marketing/styles';

// Rendered per request (plans are cached for 5 minutes) so the plans are always in the HTML.
export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  return pageMetadata({ title: 'Pricing', path: '/pricing', description: pricingSummary(await loadPublicPlans()) });
}

function Cell({ value }: { value: CompareValue }) {
  if (value === true) {
    return (
      <>
        <CheckIcon size={16} className="inline-block text-green-600" />
        <span className="sr-only">Included</span>
      </>
    );
  }
  if (value === false) {
    return (
      <>
        <DashIcon size={16} className="inline-block text-slate-300" />
        <span className="sr-only">Not included</span>
      </>
    );
  }
  return <>{value}</>;
}

export default async function PricingPage() {
  const plans = await loadPublicPlans();
  return (
    <>
      <div style={{ background: 'radial-gradient(900px 400px at 50% -50px, #dbeafe 0%, rgba(219,234,254,0) 70%)' }}>
        <div className={container}>
          <div className="pt-10 text-center md:pt-[46px]">
            <h1 className="text-balance text-[34px] font-semibold leading-[1.08] tracking-[-0.035em] text-ink sm:text-[44px] lg:text-[52px]">
              Simple pricing. Write more, worry less.
            </h1>
            <p className="mt-3.5 text-balance text-[16px] text-muted sm:text-[17px]">
              Start free. Upgrade when Videmak is saving you hours.
            </p>
          </div>
          <PricingPlans initialPlans={plans} />
        </div>
      </div>

      <div className={container}>
        {plans && <section aria-labelledby="compare-title" className="mb-16 mt-16 md:mb-[90px] md:mt-[70px]">
          <h2 id="compare-title" className="mb-5 text-[26px] font-bold tracking-[-0.02em] text-ink md:text-[30px]">
            Compare plans
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13.5px] sm:text-[15px]">
              <thead>
                <tr>
                  <th scope="col" className="border-b border-line px-2 py-3 text-left text-sm font-semibold text-muted sm:px-4">
                    Feature
                  </th>
                  {plans.map(({ name }) => (
                    <th
                      key={name}
                      scope="col"
                      className="border-b border-line px-2 py-3 text-center text-sm font-semibold text-muted sm:px-4"
                    >
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparisonRows(plans).map((row) => (
                  <tr key={row.feature}>
                    <th
                      scope="row"
                      className="w-[40%] border-b border-line-2 px-2 py-3.5 text-left font-medium text-ink sm:w-auto sm:px-4"
                    >
                      {row.feature}
                    </th>
                    {row.values.map((value, index) => (
                      <td key={index} className="whitespace-nowrap border-b border-line-2 px-1.5 py-3.5 text-center text-ink-2 sm:px-4">
                        <Cell value={value} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>}
      </div>
    </>
  );
}
