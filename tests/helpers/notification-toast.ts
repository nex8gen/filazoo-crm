import type { ReactNode } from "react";

// Keep notices inspectable in component fixtures that already replace portals
// with DOM shells. The real notification lifecycle is covered in notifications.test.ts.
export const notificationToastModule = {
  NotificationToast: ({ children }: { children?: ReactNode }) => children,
};
