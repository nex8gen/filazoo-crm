import "server-only";

export type IntegrationStatus={id:string;name:string;detail:string;configured:boolean;required:string[]};

const present=(name:string)=>Boolean(process.env[name]?.trim());
const anyPresent=(names:string[])=>names.some(present);

export function getIntegrationStatuses():IntegrationStatus[]{return[
  {id:"supabase",name:"Supabase",detail:"Company memory, authentication, and catalog storage",configured:present("NEXT_PUBLIC_SUPABASE_URL")&&anyPresent(["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY","NEXT_PUBLIC_SUPABASE_ANON_KEY"])&&anyPresent(["SUPABASE_SECRET_KEY","SUPABASE_SERVICE_ROLE_KEY"]),required:["NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY","SUPABASE_SECRET_KEY"]},
  {id:"sheets",name:"Google Sheets",detail:"Product, price, MOQ, and availability source",configured:present("GOOGLE_SHEET_ID")&&present("GOOGLE_SERVICE_ACCOUNT_EMAIL")&&present("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"),required:["GOOGLE_SHEET_ID","GOOGLE_SERVICE_ACCOUNT_EMAIL","GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"]},
  {id:"anthropic",name:"Anthropic Claude",detail:"Profiling, personalization, and reply classification",configured:present("ANTHROPIC_API_KEY"),required:["ANTHROPIC_API_KEY"]},
  {id:"mail",name:"Outreach mailbox",detail:"Controlled sending and reply synchronization",configured:present("SMTP_HOST")&&present("SMTP_USER")&&present("SMTP_PASSWORD")&&present("IMAP_HOST"),required:["SMTP_HOST","SMTP_USER","SMTP_PASSWORD","IMAP_HOST","IMAP_USER","IMAP_PASSWORD","OUTREACH_FROM_EMAIL"]},
  {id:"telegram",name:"Telegram alerts",detail:"Immediate interested and big-order notifications",configured:present("TELEGRAM_BOT_TOKEN")&&present("TELEGRAM_CHAT_ID"),required:["TELEGRAM_BOT_TOKEN","TELEGRAM_CHAT_ID"]},
]}

export function getSetupReadiness(){const integrations=getIntegrationStatuses();const configured=integrations.filter(item=>item.configured).length;return{integrations,configured,total:integrations.length,percent:Math.round(configured/integrations.length*100),dryRun:process.env.DRY_RUN!=="false"}}
