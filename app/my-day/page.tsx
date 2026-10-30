import type { Metadata } from "next";
import { MyDayWorkspace } from "@/components/my-day-workspace";
import { getMyDayData } from "@/lib/data/my-day";

export const metadata: Metadata = { title: "My Day" };

export default async function MyDayPage() {
  return <MyDayWorkspace initial={await getMyDayData()} />;
}
