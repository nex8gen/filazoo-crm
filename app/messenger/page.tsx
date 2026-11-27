import { MessengerInbox } from "@/components/messenger-inbox";
import { getMessengerInboxData } from "@/lib/data/messenger";

export const metadata = {
  title: "Unified Messenger Inbox",
  description: "Manage social conversations, CRM operators, translation, and AI-assisted replies in one inbox.",
};

export default async function MessengerPage() {
  return <MessengerInbox data={await getMessengerInboxData()} />;
}
