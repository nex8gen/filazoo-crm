import { MessengerInbox } from "@/components/messenger-inbox";
import { getMetaInboxData } from "@/lib/meta-messenger";

export const metadata = { title: "Meta Messenger" };

export default async function MessengerPage() {
  return <MessengerInbox data={await getMetaInboxData()} />;
}
