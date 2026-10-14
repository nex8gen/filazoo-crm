import { MessengerInbox } from "@/components/messenger-inbox";
import { getMetaInboxData } from "@/lib/meta-messenger";

export const metadata = {
  title: "Unified Messenger Inbox",
  description: "Manage social conversations, CRM operators, translation, and AI-assisted replies in one inbox.",
};

export default async function MessengerPage() {
  return <MessengerInbox data={await getMetaInboxData()} />;
}
