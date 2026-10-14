import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Data Deletion Instructions",
  description: "How to request deletion of personal information stored by Filazoo.",
};

export default function DataDeletionPage() {
  return (
    <LegalPage
      eyebrow="Privacy request"
      title="Data Deletion Instructions"
      description="You can ask Filazoo to delete personal information associated with a Facebook Page conversation, Lead Ad submission, or Filazoo workspace."
      updated="October 12, 2026"
    >
      <section>
        <h2>How to submit a request</h2>
        <p>
          Email <a href="mailto:raul@filazoo.com?subject=Filazoo%20Data%20Deletion%20Request">raul@filazoo.com</a> with the subject “Filazoo Data Deletion Request.”
        </p>
        <p>Include enough information for us to identify the relevant record:</p>
        <ul>
          <li>Your name and preferred reply email address.</li>
          <li>The Facebook Page or Filazoo workspace you contacted.</li>
          <li>The email address or phone number used in a Facebook Lead Form, if applicable.</li>
          <li>The approximate date of the conversation or form submission.</li>
          <li>Whether you want specific records deleted or all personal information associated with you.</li>
        </ul>
        <p>Do not send a password, access token, payment-card number, or government identification document by email.</p>
      </section>

      <section>
        <h2>Verification</h2>
        <p>
          To protect against unauthorized deletion, we may ask for limited additional information to verify your identity and your relationship to the relevant conversation, lead submission, or workspace. We will use verification information only to handle the request.
        </p>
      </section>

      <section>
        <h2>What happens next</h2>
        <ul>
          <li>We will acknowledge the request using the contact information you provide.</li>
          <li>After verification, we will locate the associated Filazoo records and delete or de-identify information that is not required for security, legal, or fraud-prevention purposes.</li>
          <li>We generally aim to complete verified requests within 30 days. We will notify you if additional time is reasonably required.</li>
          <li>We will confirm when the request has been completed or explain any information we must retain and the reason.</li>
        </ul>
      </section>

      <section>
        <h2>Disconnecting Facebook or Shopify</h2>
        <p>
          A business administrator can also remove Filazoo’s access from the connected platform’s business or application settings. Disconnecting an integration stops future collection through that connection, but it does not automatically delete information already stored in Filazoo. Use the request process above to delete existing information.
        </p>
      </section>

      <section>
        <h2>Questions</h2>
        <p>
          For questions about this process, contact <a href="mailto:raul@filazoo.com">raul@filazoo.com</a>. You can also read the full <a href="/privacy">Filazoo Privacy Policy</a>.
        </p>
      </section>
    </LegalPage>
  );
}
