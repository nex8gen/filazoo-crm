# Filazoo B2B Automation + CRM: Project Plan

Put this file in the root of the `filazoo-crm` project folder. Give it to your AI coding tool at the start of each session so it knows the whole plan.

---

## 1. Goal

Build one system (automation + our own web CRM) that:

1. **Discovers** B2B prospects worldwide: 3D printing farms, service bureaus, rapid prototyping companies, filament distributors, resellers, industrial manufacturers using FDM, engineering companies, universities and labs, makerspaces and training centers.
2. **Finds** contact emails and company information, and verifies them.
3. **Stores** everything as a company "memory" in a database.
4. **Profiles** each company with AI (what they print, likely filament needs, interest tags, fit score).
5. **Writes** a personalized email for each company, with a catalog containing only the products they are likely to want.
6. **Sends** the emails slowly and safely, with follow-ups.
7. **Reads replies**, classifies them with AI, follows up on simple ones, and **alerts us immediately** on big-order interest.
8. **Keeps the catalog current**: products and prices are edited manually in Google Sheets, and the catalog (our own design) updates automatically every week.

---

## 2. Key decisions made

| Topic | Decision |
|---|---|
| Main brand domain | `filazoo.com` (Shopify B2C store). **Never send cold email from it.** We do not control its DNS, so no subdomains for now. |
| Cold outreach domain | `filazoo.co` (new). Redirect it to `filazoo.com/b2b`. Keep a backup domain ready (for example `getfilazoo.com`) in case one gets burned. |
| CRM web address | `app.filazoo.co` for now. Move to `crm.filazoo.com` later if we get DNS access. Keep the app URL in an environment variable. |
| Existing 163 enterprise mail | Keep for normal business mail on the main domain. Not used for cold outreach. |
| Klaviyo (B2C email) | Never used for cold outreach (its policies require permission-based sending). Only opted-in or existing B2B customers are pushed to it later. Store a `consent_source` on each contact. |
| Mailboxes for outreach | Zoho Mail (cheaper) or Google Workspace / Microsoft 365 (better deliverability). Build against **SMTP/IMAP** so we can switch by changing settings only. |
| Build approach | Build everything that costs nothing first, with a **dry-run mode** for sending. Start paid services only when the build is done. Exception: buy the domain and start mailbox warm-up about 3 weeks before the first real send. |
| Catalog delivery | Link to a live catalog page in the first email. Attach the PDF only in replies after they engage. Every PDF shows its price date. |

---

## 3. Tech stack

| Layer | Tool | Cost while building |
|---|---|---|
| CRM web app | Next.js 16 + TypeScript + Tailwind | Free |
| Database, login, file storage | Supabase (PostgreSQL) | Free tier |
| Hosting | Vercel (app), Railway or Render (PDF worker) | Free tier / small |
| Background jobs | Inngest (free plan: 50K runs/month; check the pricing page) | Free |
| AI | Claude API (cheaper model for profiling and classification, stronger model for writing emails) | Pay per use, set a spending limit |
| Product data | Google Sheets API | Free |
| Catalog PDF | HTML template + Playwright | Free |
| Alerts | Telegram bot | Free |
| Error logging | Sentry free tier, or an `error_logs` table | Free |
| Code storage | GitHub | Free |

### Paid later (leave until the build is done)

| Item | Approx. cost |
|---|---|
| Outreach domain(s) | about $10-15 per year each |
| Mailboxes (Zoho or Google/Microsoft) | about $3-35 per month |
| Lead data (Apollo or Hunter) | about $50 per month |
| Scraping (Apify or Outscraper) | about $10-30 per month |
| Email verification | about $10-15 per month |
| Claude API usage | about $15-40 per month |

Prices change. Check each provider's current pricing before buying.

---

## 4. Architecture

```
Discover companies  ->  Find + verify emails  ->  Save to database
        |
        v
AI profile (interest tags, fit score)  ->  Match products  ->  Generate catalog
        |
        v
AI writes email  ->  Human approval queue  ->  Scheduled sending (daily limits)
        |
        v
Replies read (IMAP/API)  ->  AI classifies  ->  Auto-answer simple questions
                                             ->  ALERT human on interested / big order
                                             ->  Suppress unsubscribes and bounces
```

### Folder structure

```
/app            CRM pages (dashboard, companies, pipeline, emails)
/app/api        webhooks, unsubscribe endpoint
/lib            supabase, claude, apollo, mail, sheets, telegram helpers
/jobs           background jobs (discover, enrich, profile, send, sync)
/templates      catalog HTML template
```

### Modules (keep each one separate so paid services can be swapped in later)

- `findLeads()`: Apollo / Apify (start with a hand-made CSV of 20-30 test companies)
- `findEmails()` and `verifyEmail()`: Hunter / Apollo / ZeroBounce
- `sendEmail()` and `readReplies()`: SMTP/IMAP, with `DRY_RUN=true` by default
- `generateCatalog(companyId, skus[])`
- `profileCompany(url)` and `classifyReply(text)`: Claude

---

## 5. Database schema

Run this in Supabase: **SQL Editor -> New query -> Run**.

```sql
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  website text,
  domain text unique,
  country text,
  segment text,
  source text,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text,
  role text,
  email text not null unique,
  verified boolean not null default false,
  unsubscribed boolean not null default false,
  consent_source text,
  created_at timestamptz not null default now()
);

create table company_profiles (
  company_id uuid primary key references companies(id) on delete cascade,
  summary text,
  products_they_print text,
  company_size text,
  fit_score int,
  interest_tags text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table products (
  sku text primary key,
  name text not null,
  material text,
  color text,
  price numeric(10,2),
  moq int,
  tags text[] not null default '{}',
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table emails (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  direction text not null check (direction in ('sent','received')),
  subject text,
  body text,
  thread_id text,
  message_id text,
  status text not null default 'draft',
  step int default 1,
  scheduled_for timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table catalogs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  product_skus text[] not null default '{}',
  pdf_url text,
  price_date date not null default current_date,
  created_at timestamptz not null default now()
);

create table pipeline (
  company_id uuid primary key references companies(id) on delete cascade,
  stage text not null default 'new',
  notes text,
  next_followup_at timestamptz,
  updated_at timestamptz not null default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  type text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table suppression (
  email text primary key,
  reason text,
  created_at timestamptz not null default now()
);

create index on contacts (company_id);
create index on emails (contact_id);
create index on emails (status, scheduled_for);
create index on events (company_id, created_at desc);

alter table companies         enable row level security;
alter table contacts          enable row level security;
alter table company_profiles  enable row level security;
alter table products          enable row level security;
alter table emails            enable row level security;
alter table catalogs          enable row level security;
alter table pipeline          enable row level security;
alter table events            enable row level security;
alter table suppression       enable row level security;
```

Row Level Security is on with no public policies, so only the server (service role key) can read or write. Add login policies for the team when the login page is built.

**Pipeline stages:** new, contacted, replied, interested, big_order, won, lost.

---

## 6. Build steps

| # | Step | Notes |
|---|---|---|
| 1 | Environment setup | Node 20+, Git, VS Code |
| 2 | Create Next.js project | `create-next-app` |
| 3 | `.env.local` with Supabase keys | Never commit or share |
| 4 | Create database tables | SQL above |
| 5 | **Google Sheets product sync** | Service account, zod validation, weekly Inngest cron plus a "Sync now" button |
| 6 | **Catalog PDF generator** | HTML template -> Playwright PDF -> Supabase Storage; filter by interest tags; show price date |
| 7 | CRM dashboard | Login, companies list, company detail, Kanban pipeline, email approval queue, replies inbox, settings |
| 8 | Lead import | CSV import first; Apollo and Apify later; dedupe by website domain |
| 9 | Email finding and verification | Hunter/Apollo plus ZeroBounce (paid, later) |
| 10 | AI company profiling | Fetch website text -> Claude returns JSON -> validate with zod -> skip fit score below 5 |
| 11 | AI email generation | 80-120 words, plain text, one specific detail, no invented facts, one email plus two follow-ups |
| 12 | Sending engine | Daily limits per mailbox, business hours by recipient timezone, random delays, mailbox rotation, auto-pause on high bounces |
| 13 | Reply handling | Poll every 2-5 minutes, match thread, stop follow-ups, classify, act |
| 14 | Telegram alerts | Company, country, summary, link to CRM page |
| 15 | Follow-up logic | Day 3-4 and day 7, each adding value; stop on reply, unsubscribe or bounce |
| 16 | Deploy | Vercel + worker for PDFs; secrets in environment variables; Sentry |
| 17 | Test, then scale slowly | See safety rules below |

### Reply classification

`interested`, `question`, `big_order`, `not_now`, `unsubscribe`, `out_of_office`, `wrong_person`, `bounce`

| Result | Action |
|---|---|
| unsubscribe, bounce | Add to `suppression` immediately |
| not_now | Set a follow-up date months ahead |
| question | Claude drafts an answer from product data (human approves at first) |
| interested, big_order | Move stage, send Telegram alert, **stop auto-reply so a human takes over** |
| Unsure | Treat as "needs human" and alert |

---

## 7. Safety and compliance rules

1. **Never cold-email from `filazoo.com` or through Klaviyo.**
2. Check the `suppression` table before **every** send.
3. Every email has an unsubscribe link, the business name and a business address.
4. Warm up new mailboxes for 2-3 weeks. Start at 20 emails per day per mailbox and add about 10 per week.
5. Auto-pause sending if bounce rate goes above about 3% or spam complaints appear.
6. Approve the first 100 emails by hand.
7. Only email verified addresses.
8. AI may only use facts from the company profile and product data. No invented claims.
9. Log every AI decision (prompt, output, classification).
10. For EU and UK contacts, keep outreach strictly business-relevant and honor opt-outs immediately.
11. Keep API keys in `.env.local`. Never paste them into chat or commit them.
12. Build and test with `DRY_RUN=true` so no real emails go out during development.

---

## 8. Mailbox and DNS setup (later, when ready to send)

1. Buy `filazoo.co`. Put DNS on Cloudflare (free). Turn on auto-renew and two-factor login.
2. Redirect `filazoo.co` and `www.filazoo.co` to `https://filazoo.com/b2b` (301).
3. Create 2-3 mailboxes (Zoho or Google/Microsoft) and add MX, SPF, DKIM and DMARC records. Set mail records to **DNS only** (grey cloud) in Cloudflare.
4. Point `app.filazoo.co` (CNAME) to Vercel for the CRM.
5. Warm up for 2-3 weeks. Test inbox placement by sending to your own Gmail and Outlook accounts.
6. Check the domain history on a blocklist checker before using it.

---

## 9. Progress

### Done

- [x] Planned the full system, stack, costs and safety rules
- [x] Installed Node.js (v24) and Git
- [x] Created the Next.js project `filazoo-crm` (Next.js 16, TypeScript, Tailwind)
- [x] Installed `@supabase/supabase-js` and `zod`
- [x] Ran the dev server successfully at `http://localhost:3000`
- [x] Opened the project folder in VS Code

### Next

- [ ] Create `.env.local` with the three Supabase values
- [ ] Run the SQL schema in Supabase and confirm 9 tables
- [ ] Share Google Sheet product columns with 3-5 example rows
- [ ] Share the list of product categories (PLA, PETG, ABS, TPU and so on)
- [ ] Build the Google Sheets product sync
- [ ] Build the catalog PDF generator

### Later

- [ ] Create GitHub repo and push the project
- [ ] Review `npm audit` warnings before deploying (do not run `npm audit fix --force` blindly)
- [ ] Set a spending limit in the Anthropic console
- [ ] Buy `filazoo.co` and start warm-up about 3 weeks before the first send
- [ ] Ask the `filazoo.com` DNS owner for `crm.filazoo.com` (optional)

---

## 10. Open questions

1. What are the columns of the product Google Sheet (SKU, name, material, color, price, MOQ, tags, active)?
2. What product categories do we sell?
3. What format is the existing catalog design (PDF, Canva, Figma)?
4. Which mailbox provider will we use: Zoho or Google Workspace?
5. What order size should trigger a "big order" alert?
6. Which countries and segments do we target first? (Start with one country and one segment, about 500 leads.)

---

## 11. Notes for the AI coding tool

- Work on **one module at a time**.
- Use TypeScript and validate all external data with zod.
- Use the schema in section 5. Ask before changing tables.
- Never hard-code keys or the app URL. Read them from environment variables.
- Write tests for the money-critical logic: suppression checks, daily send limits and price sync.
- Commit to Git after every working step.
- Default to `DRY_RUN=true` for anything that sends email.
