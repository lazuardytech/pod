import type { ReactNode } from "react";
import { DashboardLayout } from "@/shared/components";

export const metadata = {
  title: {
    template: "Pod ✦ %s",
    default: "Pod",
  },
};

export default function DashboardRootLayout({ children }: { children: ReactNode }) {
  return <DashboardLayout>{children}</DashboardLayout>;
}
