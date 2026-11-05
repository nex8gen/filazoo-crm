import { LegalPage } from "@/components/legal-page";

export const metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return <LegalPage eyebrow="Legal" title="Terms of Service" description="The terms for using Filazoo accounts, workspaces, and CRM services." updated="November 5, 2026">
    <section><h2>1. Your account</h2><p>Provide accurate account information, verify your email, and keep your credentials secure. You are responsible for activity performed using your account. Contact <a href="mailto:raul@filazoo.com">raul@filazoo.com</a> if you believe your account has been compromised.</p></section>
    <section><h2>2. Workspaces and team access</h2><p>You may create a workspace for your business or join one by invitation. Workspace owners and administrators manage membership, permissions, and connected services. Only invite people who are authorized to access your business information. Your account can belong to more than one workspace; each workspace maintains its own CRM data and team permissions.</p></section>
    <section><h2>3. Your business information</h2><p>You retain your rights to information you add to Filazoo. You authorize us to process that information to provide, secure, and maintain the service. You are responsible for having the necessary rights and permissions to upload customer records, send messages, and connect third-party accounts.</p></section>
    <section><h2>4. Acceptable use</h2><p>Do not use Filazoo for unlawful activity, spam, fraud, harassment, unauthorized access, or attempts to access information belonging to another workspace. Do not interfere with the service or misuse connected platforms. Follow the requirements of the email, messaging, and commerce providers you connect.</p></section>
    <section><h2>5. AI and connected services</h2><p>Review AI-generated information, drafts, and proposed actions before relying on them. AI output may be inaccurate or incomplete. Third-party integrations are subject to the terms and availability of their providers. Connecting a service authorizes Filazoo to perform the operations you request within the access you grant.</p></section>
    <section><h2>6. Privacy and deletion</h2><p>Our <a href="/privacy">Privacy Policy</a> explains how we handle personal information. See our <a href="/data-deletion">Data Deletion page</a> for deletion requests. Leaving a workspace removes your access; it does not automatically delete business records held by that workspace.</p></section>
    <section><h2>7. Availability and account restrictions</h2><p>We may update the service, perform maintenance, or restrict access when needed to address misuse, security issues, or legal requirements. We do not guarantee uninterrupted availability. Keep copies of business information you need independently of the service.</p></section>
    <section><h2>8. Changes and contact</h2><p>We may update these terms as the service changes. The date above identifies the latest revision. For questions about your account, workspace, or these terms, contact <a href="mailto:raul@filazoo.com">raul@filazoo.com</a>.</p></section>
  </LegalPage>;
}
