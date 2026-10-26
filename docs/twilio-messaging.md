# Twilio messaging

WhatsApp and Facebook Messenger use the existing CRM Messenger inbox. Instagram continues using Meta directly.

## Server setup

Apply `supabase/migrations/20261026020807_twilio_messaging.sql` before receiving WhatsApp messages. It extends the existing message source constraint; table permissions and RLS remain unchanged.

Set these server environment variables locally and on the deployment:

- `TWILIO_ACCOUNT_SID`: account SID from Twilio.
- `TWILIO_AUTH_TOKEN`: primary auth token; never use a public environment variable.
- `TWILIO_WHATSAPP_FROM`: `whatsapp:+<registered-number>` (or the sandbox number for testing).
- `TWILIO_FACEBOOK_FROM`: `messenger:<connected-page-id>`; leave empty until connected. Existing direct Meta Facebook messaging remains available when this is empty.
- `TWILIO_WEBHOOK_URL`: exact public HTTPS URL, including any query string, configured in Twilio, e.g. `https://<crm-domain>/api/twilio/webhook`.

Deploy the receiver before changing the Twilio callback. In WhatsApp sandbox settings or the approved WhatsApp sender, set the incoming message webhook to that URL using POST. Use the same callback for the connected Facebook sender. This endpoint handles incoming messages, not delivery status callbacks.

The receiver verifies the official Twilio signature, account SID, channel, and configured recipient. Duplicate message SIDs are ignored so webhook retries cannot extend the reply window. Storage errors return a failure instead of acknowledging a lost message. Replies require an existing inbound message within 24 hours. Twilio acceptance is not proof of delivery; inspect Twilio logs for delivery failures. Attachment events appear as attachment placeholders; media downloads and sending attachments are not implemented.

## Account requirements observed on October 26, 2026

- Facebook Messenger in the current Twilio trial redirects to the account upgrade screen. The account owner must complete the upgrade before Facebook can be linked.
- The new Console's WhatsApp trial device pairing is separate from the legacy WhatsApp sandbox.
- The legacy sandbox is activated with one joined participant. Its POST callback is configured to `https://crm.filazoosupply.com/api/twilio/webhook`.
- A sandbox is for testing. Production needs an approved WhatsApp sender.

## Verification

Run `node --experimental-strip-types --test tests/twilio-messaging.test.ts tests/meta-messenger.test.ts` and `npx tsc --noEmit`.

After activation, configuration, migration, and deployment, send a WhatsApp message from a joined tester and a Facebook message to the linked Page. Confirm each appears in the correct CRM channel. Reply from the inbox and verify receipt on the originating device. No customer messages were sent during implementation.

## Deployment status

The database migration is applied. Twilio account SID, WhatsApp sender, exact webhook URL, and the owner-approved auth token are configured in Vercel production; the auth token is a Secret. Deployment `dpl_s6V1m6HK589g5uwhSKh5nbbhuJvK` is promoted to the CRM custom domain. It contains the messaging changes on top of commit `8c2570f52ec6a377a624fbeec3bb6ba65256ac1a`; unrelated local edits were excluded.

The deployed webhook rejects unsigned form requests with HTTP 403. A real inbound WhatsApp message (`Hi`) reached storage and appeared in the signed-in inbox. The owner-approved outbound `HI` test was rejected by Twilio with error 21654 (ContentSid required). The current Twilio trial requires its approved templates and does not permit this typed reply. The UI preserves the draft and explains the account limitation. Free-text sending remains blocked until the Twilio account is upgraded; no outbound test was delivered.

The chat retains the Filazoo CRM design. Incoming messages are labeled Received on the left, and CRM replies are labeled You on the right. The WhatsApp contact number and configured business sender are shown separately; a message sent from the tester's phone into the sandbox correctly appears as inbound. Messages are not reclassified based on the tester owning both devices.

## Correct production objective

The owner wants customer conversations from the existing WhatsApp Business phone app in the CRM, while keeping the same number and phone app working. The Twilio sandbox does not provide that connection. The owner confirmed the existing business number and authorized linking it to the Filazoo Meta business portfolio. This requires an app/API coexistence setup, not Twilio's documented migration that disables use of the phone app on the same number. Do not delete or migrate the existing WhatsApp account.

The owner completed verification, and Meta confirmed the real WhatsApp Business App account is linked. Business portfolio: `1396600465251592`; WhatsApp Business App account: `1086470830641300`; phone profile ID: `1371912912680279`. Meta shows display name Filazoo and the number as Connected. This links the phone app to the business portfolio only: it does not enable CRM/API chat synchronization.

Existing Meta app `1381970877025292` (Filazoo CRM) is unpublished and configured for Messenger, Instagram, and lead capture. Its Add use cases dialog does not list WhatsApp. No additional app was created and no Meta permissions were expanded. The owner chose to use an existing provider account rather than start a new Telnyx setup; the provider name is pending. No paid provider activation or subscription was created.

Deployment `dpl_8x7GRcVoV7BSWVttf3stxYmjhwfn` clarifies the current CRM connection as a WhatsApp sandbox test and labels its conversations as test participants. Do not describe the existing WhatsApp Business account's customer messages as connected to the CRM until the coexistence onboarding, webhook receiver, app-sent echoes, CRM replies, and real customer-message verification are complete.
