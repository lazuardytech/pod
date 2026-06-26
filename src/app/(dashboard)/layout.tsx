import { DashboardLayout } from "@/shared/components";

export const metadata = {
  title: {
    template: "Pod ✦ %s",
    default: "Pod",
  },
};

export default function DashboardRootLayout({ children }) {
  return <DashboardLayout>{children}</DashboardLayout>;
}
