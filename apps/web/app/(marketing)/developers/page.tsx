import Link from 'next/link';
import { LuBookOpenCheck, LuBot, LuFileText, LuFileType2, LuGraduationCap, LuSearch, LuServer, LuShieldCheck, LuWrench } from 'react-icons/lu';
import { pageMetadata } from '@/components/marketing/seo';
import { btnGhost, btnPrimary, container, kicker, sectionTitle } from '@/components/marketing/styles';

// Prices come from the server (cached 5 minutes) so this page always matches what is charged.
export const dynamic = 'force-dynamic';

const serverUrl = process.env.VIDEMAK_SERVER_URL || 'http://localhost:4000';
/** Where Videmak Cloud answers, and the source code (shown only once it is public). */
const apiUrl = (process.env.PUBLIC_API_URL || 'https://api.videmak.net').replace(/\/+$/, '');
const githubUrl = process.env.GITHUB_URL || '';
const contact = 'mailto:hello@videmak.net?subject=Videmak%20for%20our%20institution';

type Prices = {
  services: { id: string; label: string; unit: string; credits: number; free: boolean }[];
  packs: { id: string; credits: number; cents: number; usd_per_1000: number }[];
  free_per_day: number;
  starter_credits: number;
};

async function loadPrices(): Promise<Prices | null> {
  try {
    const response = await fetch(`${serverUrl}/api/cloud/prices`, { next: { revalidate: 300 } });
    return response.ok ? ((await response.json()) as Prices) : null;
  } catch {
    return null;
  }
}

export async function generateMetadata() {
  return pageMetadata({
    title: 'Developers',
    path: '/developers',
    description: 'One Videmak key for scholarly papers, full text, research tools, AI review and Word export. Open source under MIT; pay only for what you use.',
  });
}

const SERVICES = [
  { icon: LuSearch, title: 'Papers', text: 'Search and look up scholarly works, authors and journals from CitedEvidence Scholar.', code: 'GET /v1/oa/works' },
  { icon: LuFileText, title: 'Full text and PDFs', text: 'Archived full text, XML and PDFs where a copy is available, with source and licence.', code: 'GET /v1/files/pdf/{id}' },
  { icon: LuWrench, title: 'Research tools', text: 'Multi-source search, citation networks and recommendations, over MCP or JSON.', code: 'POST /v1/mcp' },
  { icon: LuShieldCheck, title: 'Reference checks', text: 'Confirm DOIs and PubMed IDs exist before they go in a reference list.', code: 'validate_citations' },
  { icon: LuBot, title: 'AI', text: 'OpenAI-compatible chat completions on DeepSeek. Works with any OpenAI SDK.', code: 'POST /v1/chat/completions' },
  { icon: LuBookOpenCheck, title: 'AI review', text: 'A structured peer review of a manuscript: strengths, problems by severity, a recommendation.', code: 'POST /v1/review' },
  { icon: LuFileType2, title: 'Word, LaTeX and PDF', text: 'Turn editor documents into .docx, PDF or a LaTeX project.', code: 'POST /v1/convert' },
];

const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
/** $29.90, $119, $4,990. */
const usd = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0 });

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-xl bg-ink px-4 py-3.5 font-mono text-[12.5px] leading-relaxed text-slate-100"><code>{children}</code></pre>;
}

export default async function DevelopersPage() {
  const prices = await loadPrices();
  const free = prices?.free_per_day ?? 1000;
  const starter = prices?.starter_credits ?? 100;
  return (
    <>
      <div style={{ background: 'radial-gradient(900px 400px at 50% -50px, #dbeafe 0%, rgba(219,234,254,0) 70%)' }}>
        <div className={`${container} pb-12 pt-10 text-center md:pb-16 md:pt-[46px]`}>
          <p className={kicker}>Developers</p>
          <h1 className="mx-auto max-w-[820px] text-balance text-[34px] font-semibold leading-[1.08] tracking-[-0.035em] text-ink sm:text-[44px] lg:text-[52px]">
            One key for papers, full text and AI
          </h1>
          <p className="mx-auto mt-3.5 max-w-[640px] text-balance text-[16px] text-muted sm:text-[17px]">
            Videmak is open source under the MIT licence. Videmak Cloud runs the services behind it, so your own copy or your own app works out of the box. Pay only for what you use.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/developers/keys" className={`${btnPrimary} h-12 px-6 text-[16px]`}>Get a key</Link>
            <a href="#self-host" className={`${btnGhost} h-12 px-6 text-[16px]`}>Self-host</a>
            {githubUrl && <a href={githubUrl} className={`${btnGhost} h-12 px-6 text-[16px]`}>GitHub</a>}
          </div>
        </div>
      </div>

      <div className={container}>
        <section aria-labelledby="services" className="py-10 md:py-14">
          <h2 id="services" className={sectionTitle}>What one key gives you</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SERVICES.map(({ icon: Icon, title, text, code }) => (
              <div key={title} className="flex flex-col rounded-2xl border border-line bg-white p-5">
                <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand"><Icon size={20} /></span>
                <h3 className="mt-4 text-[17px] font-bold tracking-[-0.01em] text-ink">{title}</h3>
                <p className="mt-1.5 flex-1 text-[14.5px] leading-relaxed text-muted">{text}</p>
                <code className="mt-4 self-start rounded-md bg-soft px-2 py-1 font-mono text-[12px] text-ink-2">{code}</code>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="pricing" className="border-t border-line-2 py-10 md:py-14">
          <h2 id="pricing" className={sectionTitle}>Pay as you go</h2>
          <p className="mt-3 max-w-[700px] text-[16px] text-muted">One credit is one paper or file request, the same credit as CitedEvidence Scholar. Everything else is priced in credits too, on one balance.</p>
          <div className="mt-7 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-brand-100 bg-brand-50 p-5">
              <p className="text-[28px] font-bold tracking-[-0.02em] text-ink">{number(free)} free credits</p>
              <p className="mt-1 text-[14.5px] text-ink-2">Every day, for papers, full text, research tools and reference checks. Back at midnight UTC.</p>
            </div>
            <div className="rounded-2xl border border-line bg-white p-5">
              <p className="text-[28px] font-bold tracking-[-0.02em] text-ink">{number(starter)} credits to start</p>
              <p className="mt-1 text-[14.5px] text-ink-2">On your first key, to try AI, reviews and exports. Confirm your email to get both.</p>
            </div>
          </div>
          {prices && (
            <div className="mt-8 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
              <div className="overflow-x-auto rounded-2xl border border-line bg-white">
                <table className="w-full text-left text-[14px]">
                  <thead><tr className="text-[12.5px] text-muted"><th className="px-5 py-3 font-medium">Service</th><th className="px-5 py-3 text-right font-medium">Credits</th></tr></thead>
                  <tbody>
                    {prices.services.map((service) => (
                      <tr key={service.id} className="border-t border-line-2">
                        <td className="px-5 py-3 text-ink">{service.label}{service.free && <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-semibold text-green-800">Free daily</span>}</td>
                        <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-ink-2">{number(service.credits)} per {service.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-ink">Credit packs</h3>
                <ul className="mt-3 grid gap-2.5">
                  {prices.packs.map((pack) => (
                    <li key={pack.id} className="flex items-center justify-between rounded-xl border border-line bg-white px-4 py-3">
                      <span className="text-[15px] font-bold tabular-nums text-ink">{pack.credits.toLocaleString('en-US')}</span>
                      <span className="text-[14px] text-muted"><span className="font-semibold text-ink">{usd(pack.cents)}</span> · ${pack.usd_per_1000.toFixed(2)} per 1,000</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[13.5px] text-muted">Credits you buy don&apos;t expire. Automatic top-up and per-key monthly caps are optional.</p>
              </div>
            </div>
          )}
        </section>

        <section aria-labelledby="quickstart" className="border-t border-line-2 py-10 md:py-14">
          <h2 id="quickstart" className={sectionTitle}>Quick start</h2>
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2.5 text-[15px] font-semibold text-ink">Search papers</h3>
              <Code>{`curl -H "Authorization: Bearer $VIDEMAK_API_KEY" \\
  "${apiUrl}/v1/oa/works?search=sleep%20memory&per_page=5"`}</Code>
            </div>
            <div>
              <h3 className="mb-2.5 text-[15px] font-semibold text-ink">AI with any OpenAI SDK</h3>
              <Code>{`from openai import OpenAI

client = OpenAI(base_url="${apiUrl}/v1", api_key=VIDEMAK_API_KEY)
reply = client.chat.completions.create(
    model="deepseek-chat",
    messages=[{"role": "user", "content": "Summarise this abstract: ..."}],
)`}</Code>
            </div>
            <div>
              <h3 className="mb-2.5 text-[15px] font-semibold text-ink">Research tools in Claude, Cursor or any MCP client</h3>
              <Code>{`{
  "mcpServers": {
    "videmak-research": {
      "url": "${apiUrl}/v1/mcp",
      "headers": { "Authorization": "Bearer YOUR_VIDEMAK_API_KEY" }
    }
  }
}`}</Code>
            </div>
            <div>
              <h3 className="mb-2.5 text-[15px] font-semibold text-ink">Check references</h3>
              <Code>{`curl -X POST -H "Authorization: Bearer $VIDEMAK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"identifiers": ["10.1038/nrn2762", "PMID:23589831"]}' \\
  "${apiUrl}/v1/research/tools/validate_citations"`}</Code>
            </div>
          </div>
          <p className="mt-5 text-[14px] text-muted">Each response says what it cost in <code className="font-mono text-[12.5px]">X-Credits-Charged</code> and what is left in <code className="font-mono text-[12.5px]">X-Credits-Balance</code>. Out of credits returns 402.</p>
        </section>

        <section id="self-host" aria-labelledby="self-host-title" className="scroll-mt-24 border-t border-line-2 py-10 md:py-14">
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand"><LuServer size={20} /></span>
              <h2 id="self-host-title" className={`${sectionTitle} mt-4`}>Run Videmak yourself</h2>
              <p className="mt-3 text-[16px] leading-relaxed text-muted">The whole app is MIT licensed: the editor, the server and the converter. Run it with Docker on your own server. Paste one Videmak key and papers, AI, reviews and exports work at once, or connect your own providers one service at a time.</p>
              <ul className="mt-4 grid gap-2 text-[14.5px] text-ink-2">
                <li>AI: DeepSeek, OpenAI, Anthropic, OpenRouter or Ollama</li>
                <li>Papers: Scholar (free key, {number(free)} credits a day) or OpenAlex</li>
                <li>Files: this server&apos;s disk, Wasabi or any S3-compatible storage</li>
                <li>Email: SMTP or Resend</li>
              </ul>
            </div>
            <div className="flex flex-col gap-3">
              <Code>{`git clone ${githubUrl || 'https://github.com/<org>/videmak'}
cd videmak
cp .env.example .env      # set PUBLIC_URL and VIDEMAK_API_KEY
docker compose up -d      # http://localhost:3000`}</Code>
              <p className="text-[13.5px] text-muted">The README has every setting, backups and upgrades.</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="institutions" className="mb-16 border-t border-line-2 py-10 md:mb-[90px] md:py-14">
          <div className="rounded-3xl border border-line bg-soft p-6 md:p-10">
            <span className="grid size-10 place-items-center rounded-xl bg-white text-brand shadow-card"><LuGraduationCap size={20} /></span>
            <h2 id="institutions" className={`${sectionTitle} mt-4`}>For universities and research groups</h2>
            <p className="mt-3 max-w-[720px] text-[16px] leading-relaxed text-muted">Videmak for a whole department or university: hosted by us or on your own servers, set up with you, paid by invoice, with a support agreement. Ask us about single sign-on and links to your course system.</p>
            <a href={contact} className={`${btnPrimary} mt-6 h-12 px-6 text-[16px]`}>Talk to us</a>
          </div>
        </section>
      </div>
    </>
  );
}
