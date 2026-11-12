import { httpGet } from '../http.ts';
import { ExtractionError, type ExtractedArticle, type Extractor } from './types.ts';

/**
 * Workable job postings. The job pages are a JavaScript app with no text in the HTML, so postings
 * are read through Workable's public API, which the page itself uses.
 */
const API = 'https://apply.workable.com/api';

export interface WorkableRef {
  /** The company's Workable account (e.g. `raydar`); missing from the short `/j/<code>` links. */
  account: string | null;
  shortcode: string;
}

/** The API's job shape (`/api/v2/accounts/<account>/jobs/<shortcode>`), the fields we use. */
export interface WorkableJob {
  title: string;
  description?: string;
  requirements?: string;
  benefits?: string;
  location?: WorkablePlace;
  locations?: (WorkablePlace & { hidden?: boolean })[];
  remote?: boolean;
  workplace?: 'on_site' | 'hybrid' | 'remote';
  type?: string;
  published?: string;
  salary_from?: number;
  salary_to?: number;
  salary_currency_iso_code?: string;
  salary_frequency?: string;
}

interface WorkablePlace {
  city?: string;
  region?: string;
  country?: string;
}

const SHORTCODE = /^[A-Z0-9]{6,16}$/i;

/** `apply.workable.com/<account>/j/<code>`, `apply.workable.com/j/<code>` or `<account>.workable.com/j/<code>`. */
export function parseWorkableUrl(url: URL): WorkableRef | null {
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  if (host === 'apply.workable.com') {
    if (parts[0] === 'j' && SHORTCODE.test(parts[1] ?? '')) return { account: null, shortcode: parts[1]! };
    if (parts[0] && parts[0] !== 'api' && parts[1] === 'j' && SHORTCODE.test(parts[2] ?? '')) {
      return { account: parts[0].toLowerCase(), shortcode: parts[2]! };
    }
    return null;
  }
  const sub = host.match(/^([a-z0-9-]+)\.workable\.com$/)?.[1];
  if (sub && sub !== 'www' && parts[0] === 'j' && SHORTCODE.test(parts[1] ?? '')) return { account: sub, shortcode: parts[1]! };
  return null;
}

export const workableExtractor: Extractor = {
  name: 'workable',
  source: 'web',
  matches: (url) => parseWorkableUrl(url) !== null,
  async extract(url) {
    const ref = parseWorkableUrl(url)!;
    const account = ref.account ?? (await accountOf(url));
    const pageUrl = `https://apply.workable.com/${account}/j/${ref.shortcode}/`;
    const [job, company] = await Promise.all([
      getJson<WorkableJob>(`${API}/v2/accounts/${account}/jobs/${ref.shortcode}`),
      getJson<{ name?: string }>(`${API}/v1/accounts/${account}`).then((a) => a.name?.trim() || null, () => null),
    ]);
    return fromWorkableJob(job, company, pageUrl);
  },
};

/** A short link names no company; it redirects to `/<account>/j/<code>`. */
async function accountOf(url: URL): Promise<string> {
  const res = await notFoundAsGone(() => httpGet(url.href));
  const account = parseWorkableUrl(new URL(res.url))?.account;
  if (!account) throw new ExtractionError('Could not tell which company this Workable job belongs to');
  return account;
}

async function getJson<T>(url: string): Promise<T> {
  return (await (await notFoundAsGone(() => httpGet(url, { accept: 'application/json' }))).json()) as T;
}

async function notFoundAsGone(get: () => Promise<Response>): Promise<Response> {
  try {
    return await get();
  } catch (e) {
    if (/HTTP 404/.test((e as Error).message)) throw new ExtractionError('This job posting is no longer on Workable');
    throw e;
  }
}

/** A posting as an article: a line of facts (company, places, terms, pay), then its sections. */
export function fromWorkableJob(job: WorkableJob, company: string | null, pageUrl: string): ExtractedArticle {
  const places = (job.locations?.length ? job.locations.filter((l) => !l.hidden) : [job.location]).map(placeText).filter((p): p is string => !!p);
  const terms = [EMPLOYMENT[job.type ?? ''], WORKPLACE[job.workplace ?? ''] ?? (job.remote ? 'Remote' : undefined)];
  const facts = [...new Set([...places, ...terms, salaryText(job)].filter((f): f is string => !!f))].map(escapeHtml);
  const header = [company ? `<strong>${escapeHtml(company)}</strong>` : null, ...facts].filter(Boolean).join(' · ');
  const sections = [
    job.description,
    job.requirements && `<h2>Requirements</h2>${job.requirements}`,
    job.benefits && `<h2>Benefits</h2>${job.benefits}`,
  ].filter(Boolean);
  if (!sections.length) throw new ExtractionError('This Workable job has no description');

  const published = Date.parse(job.published ?? '');
  return {
    kind: 'article',
    hasVideo: false,
    title: company ? `${job.title} · ${company}` : job.title,
    byline: null,
    siteName: company,
    excerpt: null,
    leadImage: null,
    html: `${header ? `<p>${header}</p>` : ''}${sections.join('')}`,
    baseUrl: pageUrl,
    publishedAt: Number.isNaN(published) ? null : published,
  };
}

const EMPLOYMENT: Record<string, string> = {
  full: 'Full-time',
  part: 'Part-time',
  contract: 'Contract',
  temporary: 'Temporary',
  internship: 'Internship',
};
const WORKPLACE: Record<string, string> = { on_site: 'On-site', hybrid: 'Hybrid', remote: 'Remote' };

const placeText = (p: WorkablePlace | undefined) => (p ? [p.city, p.region, p.country].filter(Boolean).join(', ') || null : null);

/** "£150,000–£250,000 / year"; null when the posting states no pay. */
function salaryText(job: WorkableJob): string | null {
  const { salary_from: from, salary_to: to, salary_currency_iso_code: currency, salary_frequency: per } = job;
  if (!from && !to) return null;
  const money = (n: number) =>
    currency ? new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n) : n.toLocaleString('en-GB');
  const range = from && to && from !== to ? `${money(from)}–${money(to)}` : money((from || to)!);
  return per ? `${range} / ${per}` : range;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
