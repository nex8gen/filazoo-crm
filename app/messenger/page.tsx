import { MessengerInbox } from "@/components/messenger-inbox";
import { listMetaThreads } from "@/lib/meta-messenger";

export const metadata = { title: "Meta Messenger" };

export default async function MessengerPage() {
  return <MessengerInbox threads={await listMetaThreads()} />;
}
