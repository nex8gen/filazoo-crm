export type CompanyStatus = "New" | "Contacted" | "Replied" | "Interested" | "Big order" | "Won" | "Lost";
export type PipelineStage = "new" | "contacted" | "replied" | "interested" | "big-order" | "won" | "lost";

export type Company = {
  id: string;
  name: string;
  domain: string;
  country: string;
  city: string;
  segment: string;
  status: CompanyStatus;
  fitScore: number;
  lastActivity: string;
  summary: string;
  employees: string;
  contacts: { name: string; role: string; email: string }[];
  materials: string[];
  emails: { subject: string; date: string }[];
  catalogs: { name: string; products: number }[];
  activity: string[];
};

export type PipelineCard = {
  id: string;
  company: string;
  country: string;
  value: string;
  owner: string;
  stage: PipelineStage;
};

export const companies: Company[] = [
  { id: "orbital", name: "Orbital Form", domain: "orbitalform.de", country: "Germany", city: "Berlin", segment: "Print farm", status: "Interested", fitScore: 96, lastActivity: "12 min ago", summary: "High-volume FDM production partner focused on repeat industrial parts.", employees: "51–100", contacts: [{ name: "Lena Hoffmann", role: "Procurement Lead", email: "lena@orbitalform.de" }], materials: ["PETG", "ASA", "PA-CF"], emails: [{ subject: "Industrial filament supply", date: "Today" }], catalogs: [{ name: "Industrial materials", products: 8 }], activity: ["Replied to introduction", "Opened tailored catalog", "Added by discovery agent"] },
  { id: "layerlab", name: "LayerLab Systems", domain: "layerlabsystems.com", country: "United States", city: "Austin", segment: "Service bureau", status: "Replied", fitScore: 92, lastActivity: "1 hr ago", summary: "Engineering-led prototyping bureau serving robotics and mobility teams.", employees: "11–50", contacts: [{ name: "Marcus Reed", role: "Operations Director", email: "marcus@layerlabsystems.com" }], materials: ["PLA", "PETG", "TPU"], emails: [{ subject: "Materials for production runs", date: "Yesterday" }], catalogs: [{ name: "Fast prototyping", products: 6 }], activity: ["Requested pricing", "Viewed catalog twice", "Contact verified"] },
  { id: "nordic", name: "Nordic Additive", domain: "nordicadditive.se", country: "Sweden", city: "Gothenburg", segment: "Manufacturer", status: "Contacted", fitScore: 89, lastActivity: "3 hrs ago", summary: "Industrial manufacturer expanding its internal additive production capacity.", employees: "101–250", contacts: [{ name: "Elin Berg", role: "Manufacturing Engineer", email: "elin@nordicadditive.se" }], materials: ["ASA", "ABS", "PA"], emails: [{ subject: "Reliable FDM supply", date: "Today" }], catalogs: [{ name: "Engineering portfolio", products: 10 }], activity: ["First email sent", "Catalog generated", "Research completed"] },
  { id: "protohaus", name: "ProtoHaus", domain: "protohaus.co.uk", country: "United Kingdom", city: "Bristol", segment: "Rapid prototyping", status: "Big order", fitScore: 98, lastActivity: "Yesterday", summary: "Rapid prototyping studio evaluating a multi-pallet quarterly supply contract.", employees: "11–50", contacts: [{ name: "Amelia Price", role: "Founder", email: "amelia@protohaus.co.uk" }], materials: ["PLA", "PETG", "TPU", "ASA"], emails: [{ subject: "Quarterly volume proposal", date: "Yesterday" }], catalogs: [{ name: "Volume pricing", products: 12 }], activity: ["Requested volume quote", "Marked big-order alert", "Meeting scheduled"] },
  { id: "makergrid", name: "MakerGrid Academy", domain: "makergrid.edu", country: "Canada", city: "Toronto", segment: "Training center", status: "New", fitScore: 78, lastActivity: "2 days ago", summary: "Technical training center purchasing broad material ranges for student cohorts.", employees: "11–50", contacts: [{ name: "Nora Chen", role: "Lab Manager", email: "nora@makergrid.edu" }], materials: ["PLA", "PETG"], emails: [], catalogs: [], activity: ["Added by discovery agent", "Domain verified"] },
  { id: "fabrix", name: "Fabrix Distribution", domain: "fabrix.eu", country: "Netherlands", city: "Rotterdam", segment: "Distributor", status: "Won", fitScore: 94, lastActivity: "3 days ago", summary: "Regional distributor with a reseller network across Benelux.", employees: "51–100", contacts: [{ name: "Daan Vos", role: "Category Manager", email: "daan@fabrix.eu" }], materials: ["PLA", "PETG", "ABS", "TPU"], emails: [{ subject: "Distributor terms", date: "Last week" }], catalogs: [{ name: "Reseller collection", products: 18 }], activity: ["Moved to won", "Order confirmed", "Commercial terms approved"] },
  { id: "printforge", name: "PrintForge Labs", domain: "printforge.fr", country: "France", city: "Lyon", segment: "Print farm", status: "Contacted", fitScore: 86, lastActivity: "4 days ago", summary: "Growing print farm specializing in short-run consumer goods.", employees: "11–50", contacts: [{ name: "Louis Martin", role: "Owner", email: "louis@printforge.fr" }], materials: ["PLA", "PETG"], emails: [{ subject: "Consistent batch colors", date: "4 days ago" }], catalogs: [{ name: "Core colors", products: 7 }], activity: ["First email sent", "Email verified"] },
  { id: "vector", name: "Vector Works", domain: "vectorworks.jp", country: "Japan", city: "Osaka", segment: "Engineering", status: "New", fitScore: 84, lastActivity: "5 days ago", summary: "Mechanical engineering consultancy with an in-house prototype lab.", employees: "51–100", contacts: [{ name: "Ren Sato", role: "Lead Engineer", email: "ren@vectorworks.jp" }], materials: ["PA-CF", "PETG"], emails: [], catalogs: [], activity: ["Research completed", "Contact found"] },
  { id: "formcore", name: "FormCore", domain: "formcore.com.au", country: "Australia", city: "Melbourne", segment: "Service bureau", status: "Replied", fitScore: 90, lastActivity: "6 days ago", summary: "Full-service additive bureau sourcing reliable technical polymers.", employees: "11–50", contacts: [{ name: "Mia Cooper", role: "Supply Manager", email: "mia@formcore.com.au" }], materials: ["ASA", "TPU", "PA-CF"], emails: [{ subject: "Technical polymer range", date: "6 days ago" }], catalogs: [{ name: "Technical materials", products: 9 }], activity: ["Asked for samples", "Replied to first email"] },
  { id: "campus3d", name: "Campus 3D Lab", domain: "campus3d.ac.kr", country: "South Korea", city: "Seoul", segment: "University", status: "Interested", fitScore: 88, lastActivity: "1 week ago", summary: "University fabrication lab supporting engineering research and teaching.", employees: "250+", contacts: [{ name: "Ji-ho Park", role: "Lab Director", email: "jiho@campus3d.ac.kr" }], materials: ["PLA", "PETG", "TPU"], emails: [{ subject: "Academic supply program", date: "1 week ago" }], catalogs: [{ name: "Education range", products: 8 }], activity: ["Requested academic pricing", "Catalog opened"] },
  { id: "delta", name: "Delta Prototypes", domain: "deltaproto.mx", country: "Mexico", city: "Monterrey", segment: "Rapid prototyping", status: "Lost", fitScore: 71, lastActivity: "2 weeks ago", summary: "Prototype shop currently tied to an incumbent supplier contract.", employees: "11–50", contacts: [{ name: "Sofia Ruiz", role: "Buyer", email: "sofia@deltaproto.mx" }], materials: ["PLA", "ABS"], emails: [{ subject: "Prototype material supply", date: "2 weeks ago" }], catalogs: [], activity: ["Marked lost", "Timing not suitable"] },
  { id: "buildstack", name: "BuildStack", domain: "buildstack.pl", country: "Poland", city: "Warsaw", segment: "Reseller", status: "New", fitScore: 82, lastActivity: "2 weeks ago", summary: "Specialist desktop 3D printing reseller with a growing B2B customer base.", employees: "11–50", contacts: [{ name: "Anna Kowalska", role: "Purchasing", email: "anna@buildstack.pl" }], materials: ["PLA", "PETG", "TPU"], emails: [], catalogs: [], activity: ["Added by discovery agent"] },
];

export const pipelineCards: PipelineCard[] = companies.slice(0, 10).map((company, index) => ({
  id: company.id,
  company: company.name,
  country: company.country,
  value: ["$4.8k", "$7.2k", "$12k", "$24k", "$3.6k"][index % 5],
  owner: ["RF", "AM", "SK"][index % 3],
  stage: company.status.toLowerCase().replace(" ", "-") as PipelineStage,
}));

export const dashboardStats = [
  { label: "Companies", value: "2,481", change: "+12.4% this month" },
  { label: "Emails sent", value: "18,294", change: "+8.2% this month" },
  { label: "Replies", value: "1,742", change: "9.5% reply rate" },
  { label: "Big-order alerts", value: "34", change: "+6 this week" },
];

export const weeklyActivity = [12, 20, 16, 28, 24, 32, 38, 30, 42, 36, 48, 44];
