import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Filazoo collects, uses, stores, and protects personal information.",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy Policy"
      description="This policy explains how Filazoo handles information when businesses use our CRM and connected messaging, advertising, and commerce services."
      updated="October 12, 2026"
    >
      <section>
        <h2>1. Who we are</h2>
        <p>
          Filazoo provides customer relationship management and business communication tools. Filazoo operates from Hong Kong and can be contacted at{" "}
          <a href="mailto:raul@filazoo.com">raul@filazoo.com</a>. References to “Filazoo,” “we,” “us,” or “our” in this policy refer to the operator of the Filazoo service.
        </p>
      </section>

      <section>
        <h2>2. Information we collect</h2>
        <p>Depending on how the service is used and which integrations are enabled, we may process:</p>
        <ul>
          <li>Account and workspace information, including names, email addresses, roles, and authentication records.</li>
          <li>CRM information entered by business users, such as company, contact, billing, and outreach records.</li>
          <li>Facebook Page Messenger information, including Page-scoped user identifiers, profile names made available by Meta, message text, attachment metadata, timestamps, and reply status.</li>
          <li>Facebook Lead Ads information, including form responses such as name, email address, phone number, form identifiers, advertisement identifiers, and submission time.</li>
          <li>Connected commerce information supplied through Shopify, such as store identity, product, catalog, and related operational information selected by the business using Filazoo.</li>
          <li>Technical and security information, including application events, error records, and information needed to prevent misuse and maintain the service.</li>
        </ul>
      </section>

      <section>
        <h2>3. How we receive information</h2>
        <p>
          We receive information directly from Filazoo users, from people who contact a connected Facebook Page or submit a connected Facebook Lead Form, and from services a business chooses to connect, including Meta and Shopify.
        </p>
      </section>

      <section>
        <h2>4. How we use information</h2>
        <ul>
          <li>Provide, operate, maintain, and secure the Filazoo service.</li>
          <li>Display customer conversations and advertising leads to authorized business users.</li>
          <li>Allow authorized users to reply to Facebook Page messages and follow up with requested leads.</li>
          <li>Synchronize information from integrations selected by the business.</li>
          <li>Troubleshoot errors, prevent abuse, and improve reliability.</li>
          <li>Comply with applicable laws and enforce our agreements.</li>
        </ul>
        <p>We do not sell Facebook message or Lead Ads information or use it for unrelated advertising.</p>
      </section>

      <section>
        <h2>5. How we share information</h2>
        <p>Information may be shared only as needed with:</p>
        <ul>
          <li>The business that controls the connected Filazoo workspace and its authorized team members.</li>
          <li>Connected platforms, including Meta and Shopify, when required to perform an action requested through the service.</li>
          <li>Infrastructure and data-processing providers that help host, secure, and operate Filazoo, including Vercel and Supabase.</li>
          <li>Authorities or other parties when disclosure is legally required or necessary to protect rights, security, and safety.</li>
        </ul>
      </section>

      <section>
        <h2>6. Retention and deletion</h2>
        <p>
          We retain information for as long as needed to provide the service, support the business purposes for which it was collected, resolve disputes, maintain security, and meet legal obligations. A workspace administrator may request deletion of workspace information, and an individual may request deletion of personal information associated with a Messenger conversation or Lead Ad submission.
        </p>
        <p>Deletion instructions are available on our <a href="/data-deletion">Data Deletion page</a>.</p>
      </section>

      <section>
        <h2>7. Security and international processing</h2>
        <p>
          We use reasonable administrative, technical, and organizational measures intended to protect information against unauthorized access, loss, alteration, or disclosure. Information may be processed in countries where Filazoo or its service providers operate. Those locations may have different data-protection laws from your location.
        </p>
      </section>

      <section>
        <h2>8. Your choices and rights</h2>
        <p>
          Depending on applicable law, you may have the right to request access to, correction of, or deletion of your personal information, or to object to or restrict certain processing. We may need to verify your identity and connection to the relevant Page, form submission, or workspace before completing a request.
        </p>
      </section>

      <section>
        <h2>9. Children</h2>
        <p>
          Filazoo is a business service and is not directed to children. We do not knowingly collect personal information from children through the service.
        </p>
      </section>

      <section>
        <h2>10. Changes and contact</h2>
        <p>
          We may update this policy to reflect service, legal, or operational changes. The date above identifies the latest revision. Questions or privacy requests can be sent to{" "}
          <a href="mailto:raul@filazoo.com">raul@filazoo.com</a>.
        </p>
      </section>
    </LegalPage>
  );
}
