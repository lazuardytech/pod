import LogsClient from "./LogsClient";

export const dynamic = "force-dynamic";

export const metadata = { title: "Logs" };

export default function LogsPage() {
  return <LogsClient />;
}
