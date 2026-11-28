"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronDown, ClipboardList, Globe2, Mail, Menu, MessageCircle, Package, Play, Plus, ShieldCheck, Sparkles, Users, Workflow, X } from "lucide-react";
import { BrandMark, BrandMarkIcon } from "@/components/brand-mark";
import { MARKETING_APP_ORIGIN } from "@/lib/marketing";
import { categories, faqs, features, type Category } from "./marketing-data";
import { CrmProductTour } from "./crm-product-tour";
import styles from "./reference-marketing.module.css";

const app = MARKETING_APP_ORIGIN;
type DemoView = "home" | "email" | "workflow" | "orders";

function CrmSnapshot({ view, label, crop = false }: { view: DemoView; label: string; crop?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  const sourceWidth = crop ? 1044 : 1280;
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setScale(entries[0].contentRect.width / sourceWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [sourceWidth]);
  return <div ref={container} className={styles.snapshot} aria-label={label}>
    <iframe src={`/marketing/crm-demo/${view}.html`} title={`${label} — actual CRM with demo data`} loading="lazy" sandbox="allow-same-origin" tabIndex={-1} width={1280} height={800} style={{ transform: `translate(${-1 * (crop ? 236 : 0) * scale}px, ${-1 * (crop ? 48 : 0) * scale}px) scale(${scale})` }} />
  </div>;
}

function ConnectionIcon({ kind }: { kind: "shopify" | "meta" | "email" | "website" }) {
  if (kind === "shopify") return <img src="/shopify-mark.svg" alt="" width={26} height={26} />;
  if (kind === "meta") return <img src="/meta-mark.svg" alt="" width={29} height={22} />;
  if (kind === "email") return <Mail size={23} />;
  return <Globe2 size={23} />;
}

const steps: { label: string; title: string; text: string; view: DemoView; icon: typeof Mail }[] = [
  { label: "Connect", title: "Keep every conversation close.", text: "Bring your business email and customer context together. Read, translate, and prepare thoughtful replies from the same workspace.", view: "email", icon: Mail },
  { label: "Follow up", title: "A next step for every inquiry.", text: "Build a visual workflow with triggers, waits, AI replies, and team tasks. Preview the journey, then activate it when you’re ready.", view: "workflow", icon: Workflow },
  { label: "Deliver", title: "Turn a good conversation into an order.", text: "Keep product pricing, quotations, purchase orders, invoices, and payments connected to the customer, from first offer to fulfillment.", view: "orders", icon: ClipboardList },
];

export function MarketingSite() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [category, setCategory] = useState<Category>("All features");
  const [step, setStep] = useState(1);
  const current = steps[step];
  return <div className={styles.site}>
    <a href="#main" className={styles.skipLink}>Skip to content</a>
    <header className={styles.header}>
      <div className={styles.navContainer}>
        <a href="#" className={styles.logo} aria-label="NewAI home"><BrandMark /></a>
        <nav className={styles.desktopNav} aria-label="Main navigation"><a href="#platform">Why NewAI</a><a href="#how-it-works">How it works</a><a href="#features">Features</a><a href="#integrations">Integrations</a></nav>
        <div className={styles.navActions}><a className={styles.login} href={`${app}/login`}>Log in</a><a className={styles.buttonSmall} href={`${app}/signup`}>Get started</a><button className={styles.menuToggle} aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} aria-controls="marketing-mobile-nav" onClick={() => setMenuOpen(value => !value)}>{menuOpen ? <X size={21} /> : <Menu size={21} />}</button></div>
      </div>
      {menuOpen && <nav id="marketing-mobile-nav" className={styles.mobileNav} aria-label="Mobile navigation">{[["Why NewAI", "platform"], ["How it works", "how-it-works"], ["All features", "features"], ["Integrations", "integrations"], ["FAQs", "faq"]].map(([label, id]) => <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)}>{label}</a>)}<a href={`${app}/login`}>Log in</a></nav>}
    </header>

    <main id="main">
      <section className={styles.hero}>
        <div className={styles.orbits} aria-hidden="true"><i /><i /><i /></div>
        <div className={`${styles.floatingTile} ${styles.floatShopify}`} aria-hidden="true"><ConnectionIcon kind="shopify" /></div>
        <div className={`${styles.floatingTile} ${styles.floatMeta}`} aria-hidden="true"><ConnectionIcon kind="meta" /></div>
        <div className={`${styles.floatingTile} ${styles.floatMail}`} aria-hidden="true"><Mail size={25} /></div>
        <div className={`${styles.floatingTile} ${styles.floatAi}`} aria-hidden="true"><Sparkles size={26} /></div>
        <div className={`${styles.floatingTile} ${styles.floatProduct}`} aria-hidden="true"><Package size={25} /></div>
        <div className={`${styles.floatingTile} ${styles.floatFlow}`} aria-hidden="true"><Workflow size={24} /></div>
        <div className={styles.heroContent}>
          <div className={styles.heroPill}><span><Sparkles size={13} /></span> Your customers. Your team. A little AI.</div>
          <h1>Sell smarter,<br />grow together.</h1>
          <p>The AI sales workspace that brings your customers, conversations, and orders together. Less switching. More moving forward.</p>
          <div className={styles.heroActions}><a className={styles.button} href={`${app}/signup`}>Get started with NewAI</a><a className={styles.secondaryButton} href="#product-tour"><Play size={14} fill="currentColor" />See the CRM</a></div>
          <span className={styles.heroNote}><Check size={13} /> Built for B2B teams and the relationships behind every order.</span>
        </div>
        <div id="product-tour" className={styles.tourWrapper}><CrmProductTour compact /></div>
      </section>

      <section className={styles.connections} aria-label="Supported connections"><p>Your favorite tools. One connected workspace.</p><div>{[{ kind: "shopify", label: "Shopify" }, { kind: "meta", label: "Meta" }, { kind: "email", label: "Business email" }, { kind: "website", label: "Your website" }].map(({ kind, label }) => <span key={kind}><ConnectionIcon kind={kind as "shopify" | "meta" | "email" | "website"} />{label}</span>)}</div></section>

      <section id="platform" className={styles.platform}>
        <div className={styles.sectionHeading}><span className={styles.eyebrow}>A BETTER WAY TO DO BUSINESS</span><h2>Good relationships.<br />Great things ahead.</h2><p>The everyday tools your sales team needs.<br />Thoughtfully connected, with AI along for the ride.</p></div>
        <div className={styles.bento}>
          <article className={styles.brandCard}>
            <div className={styles.brandArtwork} aria-hidden="true"><span className={styles.artHalo} /><span className={styles.artTile}><BrandMarkIcon /></span><span className={`${styles.artSatellite} ${styles.artMail}`}><Mail size={27} /></span><span className={`${styles.artSatellite} ${styles.artPeople}`}><Users size={27} /></span><span className={`${styles.artSatellite} ${styles.artOrders}`}><ClipboardList size={26} /></span><span className={`${styles.artSatellite} ${styles.artSparkles}`}><Sparkles size={27} /></span><span className={`${styles.artSatellite} ${styles.artMessage}`}><MessageCircle size={26} /></span></div>
            <div className={styles.brandCardCopy}><span>MEET YOUR NEW WORKSPACE</span><h3>A little AI.<br />A lot more possibility.</h3><p>Find your next opportunity. Make the right offer. Keep your whole team in the picture.</p><a href={`${app}/signup`}>Make yourself at home</a></div>
          </article>
          <article className={styles.previewCard}><div className={styles.cardPreview}><CrmSnapshot view="email" label="Your NewAI email workspace" crop /></div><div className={styles.cardCopy}><span className={styles.cardLabel}><Mail size={14} /> EMAIL & CUSTOMER CONTEXT</span><h3>Every conversation, connected.</h3><p>Your inbox, customer details, and AI-assisted writing. Right where you need them.</p></div></article>
          <article className={styles.previewCard}><div className={styles.cardPreview}><CrmSnapshot view="workflow" label="Your NewAI visual workflow builder" crop /></div><div className={styles.cardCopy}><span className={styles.cardLabel}><Workflow size={14} /> VISUAL WORKFLOWS</span><h3>Keep the good things going.</h3><p>Turn the next step into a workflow, with timely follow-ups and clear team tasks.</p></div></article>
          <article className={`${styles.previewCard} ${styles.orderCard}`}><div className={styles.orderCardCopy}><span className={styles.cardLabel}><ClipboardList size={14} /> SALES, WITHOUT THE SCATTER</span><h3>All the details.<br />One clear picture.</h3><p>Products, quotations, orders, invoices, and payments. Always close to the customer.</p><a href="#features" onClick={() => setCategory("Sell & deliver")}>Explore your sales toolkit</a></div><div className={styles.orderPreview}><CrmSnapshot view="orders" label="Your NewAI purchase order register" crop /></div></article>
        </div>
        <p className={styles.demoFootnote}>Product previews show the actual NewAI CRM with sample data.</p>
      </section>

      <section id="how-it-works" className={styles.howSection}>
        <div className={styles.sectionHeading}><span className={styles.eyebrow}>FROM FIRST HELLO TO WHAT’S NEXT</span><h2>Less juggling.<br />More getting things done.</h2><p>A connected sales day, one thoughtful step at a time.</p></div>
        <div className={styles.stepTabs} role="tablist" aria-label="Explore your sales workflow">{steps.map(({ label, icon: Icon }, index) => <button key={label} id={`workflow-step-${index}`} role="tab" aria-selected={step === index} aria-controls="workflow-step-panel" tabIndex={step === index ? 0 : -1} onClick={() => setStep(index)} onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? steps.length - 1 : (index + (event.key === "ArrowRight" ? 1 : steps.length - 1)) % steps.length; setStep(next); document.getElementById(`workflow-step-${next}`)?.focus(); }}><Icon size={16} />{label}</button>)}</div>
        <div className={styles.stepCard} id="workflow-step-panel" role="tabpanel" aria-labelledby={`workflow-step-${step}`}><div className={styles.stepCopy}><span className={styles.stepLabel}>{current.label}</span><h3>{current.title}</h3><p>{current.text}</p><a href={`${app}/signup`} className={styles.buttonSmall}>Get started</a></div><div className={styles.stepPreview}><CrmSnapshot key={current.view} view={current.view} label={current.title} crop /></div></div>
      </section>

      <section id="features" className={styles.features}>
        <div className={styles.featureHeader}><div><span className={styles.eyebrow}>A PLACE FOR EVERY PART OF YOUR DAY</span><h2>Discover what<br />NewAI can do.</h2><p>One workspace. Your whole business toolkit.</p></div><div className={styles.featureFilters} role="group" aria-label="Filter product features">{categories.map(value => <button key={value} onClick={() => setCategory(value)} aria-pressed={category === value}>{value}</button>)}</div></div>
        <div className={styles.featureGrid} aria-live="polite" aria-atomic="false">{features.filter(feature => category === "All features" || feature.category === category).map(({ title, text, icon: Icon, beta }) => <article key={title} className={styles.featureCard}><span className={styles.featureIllustration} aria-hidden="true"><i /><Icon size={33} strokeWidth={1.2} /></span><h3>{title}{beta && <span className={styles.beta}>Beta</span>}</h3><p>{text}</p></article>)}</div>
      </section>

      <section className={styles.teamsSection}><div className={styles.teamsContainer}><div className={styles.leftHeading}><span className={styles.eyebrow}>EVERYONE ON THE SAME PAGE</span><h2>A little more clarity.<br />For your whole team.</h2></div><div className={styles.teamCards}>
        <article><span className={styles.roleIcon}><Building2 size={24} /></span><h3>For business owners</h3><p>Keep your customer relationships, sales activity, and team priorities in view. Know where the conversation stands and what comes next.</p><div className={styles.teamCardFooter}><span>Business overview</span><span>Connected operations</span></div></article>
        <article className={styles.teamAccent}><span className={styles.roleIcon}><Users size={24} /></span><h3>For sales teams</h3><p>Arrive informed, make it personal, and follow through. Give every account a clear owner and every customer a thoughtful next step.</p><div className={styles.teamCardFooter}><span>Customer context</span><span>Clear ownership</span></div></article>
        <article><span className={styles.roleIcon}><Package size={24} /></span><h3>For operators</h3><p>Bring the details together, from product pricing and business documents to purchase orders, invoices, and recorded payments.</p><div className={styles.teamCardFooter}><span>Organized orders</span><span>Fewer loose ends</span></div></article>
      </div></div></section>

      <section id="integrations" className={styles.integrations}><div className={styles.sectionHeading}><span className={styles.eyebrow}>BETTER CONNECTED</span><h2>Your tools.<br />Working together.</h2><p>Bring in business email, store inquiries, and social leads.<br />Keep the customer relationship in one place.</p></div><div className={styles.integrationStage}><div className={styles.integrationRing} aria-hidden="true" /><div className={styles.integrationHub} aria-hidden="true"><BrandMarkIcon /></div>{[{ kind: "shopify", name: "Shopify", text: "Store inquiries & products" }, { kind: "meta", name: "Meta", text: "Lead ads & Page Messenger" }, { kind: "email", name: "Business email", text: "SMTP & IMAP mailboxes" }, { kind: "website", name: "Your website", text: "Customer sites & domains" }].map(({ kind, name, text }, index) => <div key={kind} className={`${styles.integrationNode} ${styles[`node${index}`]}`}><span><ConnectionIcon kind={kind as "shopify" | "meta" | "email" | "website"} /></span><div><strong>{name}</strong><p>{text}</p></div></div>)}</div><a href={`${app}/signup`} className={styles.secondaryButton}>Build your connected workspace</a></section>

      <section className={styles.controls} aria-label="Workspace controls"><article><ShieldCheck size={21} /><h3>Your data, your workspace.</h3><p>AI access follows workspace settings and current customer assignments.</p></article><article><Workflow size={21} /><h3>Move at your own pace.</h3><p>Review drafts and preview workflows before putting them to work.</p></article><article><Sparkles size={21} /><h3>A clear view of AI usage.</h3><p>See credit balances and activity as your business grows.</p></article></section>

      <section id="faq" className={styles.faq}><div><span className={styles.eyebrow}>A FEW THINGS YOU MIGHT WONDER</span><h2>Good questions.<br />Clear answers.</h2><p>Get to know your next workspace.</p></div><div className={styles.faqList}>{faqs.map(([question, answer]) => <details key={question}><summary>{question}<Plus size={17} /></summary><p>{answer}</p></details>)}</div></section>

      <section className={styles.finalCta}><div className={styles.ctaMark} aria-hidden="true"><BrandMarkIcon /></div><h2>Big things start<br />with a better connection.</h2><p>Make room for more business. Make it happen with NewAI.</p><a href={`${app}/signup`} className={styles.button}>Get started with NewAI</a><span>Already have a workspace? <a href={`${app}/login`}>Log in</a></span></section>
    </main>

    <footer className={styles.footer}><div className={styles.footerTop}><div><a href="#" className={styles.footerLogo} aria-label="NewAI home"><BrandMark /></a><p>Better connections.<br />More possibilities.</p><span>www.newai.xin</span></div><div><strong>Explore NewAI</strong><a href="#platform">Why NewAI</a><a href="#how-it-works">How it works</a><a href="#features" onClick={() => setCategory("All features")}>All features</a><a href="#integrations">Integrations</a></div><div><strong>Your workspace</strong><a href={`${app}/signup`}>Get started</a><a href={`${app}/login`}>Log in</a><a href="#product-tour">Actual CRM demo</a><a href="#faq">FAQs</a></div><div><strong>The essentials</strong><a href={`${app}/privacy`}>Privacy policy</a><a href={`${app}/terms`}>Terms of service</a><a href={`${app}/data-deletion`}>Data deletion</a></div></div><div className={styles.footerBottom}><span>© {new Date().getUTCFullYear()} NewAI. All rights reserved.</span><span>Built around your next opportunity.</span></div></footer>
  </div>;
}
