import { neon } from "@neondatabase/serverless";

type StatsRow = {
  total_signups: number | string;
  signups_last_8h: number | string;
  signups_last_24h: number | string;
  latest_signup_at: Date | string | null;
};

type LatestSignupRow = {
  created_at: Date | string;
  name: string;
  work_email: string;
  company: string;
  role: string;
  company_size: string;
  expected_users: number | string;
  willing_to_pay: string;
  decision_timeline: string;
  main_pain_point: string;
};

export type FregeSignupStats = {
  total_signups: number;
  signups_last_8h: number;
  signups_last_24h: number;
  latest_signup_at: string | null;
  latest_signups: Array<{
    created_at: string | null;
    name: string;
    work_email: string;
    company: string;
    role: string;
    company_size: string;
    expected_users: number;
    willing_to_pay: string;
    decision_timeline: string;
    main_pain_point: string;
  }>;
};

function toNumber(value: number | string): number {
  if (typeof value === "number") return value;
  return Number(value);
}

function toIsoString(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

export async function getFregeSignupStats(): Promise<FregeSignupStats> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  const sql = neon(process.env.DATABASE_URL);
  const statsRows = await sql`
    select
      count(*)::int as total_signups,
      count(*) filter (where created_at >= now() - interval '8 hours')::int as signups_last_8h,
      count(*) filter (where created_at >= now() - interval '24 hours')::int as signups_last_24h,
      max(created_at) as latest_signup_at
    from signups
  `;
  const latestRows = await sql`
    select
      created_at, name, work_email, company, role, company_size,
      expected_users, willing_to_pay, decision_timeline, main_pain_point
    from signups
    order by created_at desc
    limit 10
  `;

  const stats = statsRows[0] as StatsRow | undefined;

  return {
    total_signups: toNumber(stats?.total_signups ?? 0),
    signups_last_8h: toNumber(stats?.signups_last_8h ?? 0),
    signups_last_24h: toNumber(stats?.signups_last_24h ?? 0),
    latest_signup_at: toIsoString(stats?.latest_signup_at ?? null),
    latest_signups: (latestRows as LatestSignupRow[]).map((signup) => ({
      created_at: toIsoString(signup.created_at),
      name: signup.name,
      work_email: signup.work_email,
      company: signup.company,
      role: signup.role,
      company_size: signup.company_size,
      expected_users: toNumber(signup.expected_users),
      willing_to_pay: signup.willing_to_pay,
      decision_timeline: signup.decision_timeline,
      main_pain_point: signup.main_pain_point,
    })),
  };
}
