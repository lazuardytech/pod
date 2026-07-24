import { Spinner } from "@/shared/components/Loading";

export default function DashboardLoading() {
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center"
      aria-busy="true"
      aria-label="Loading"
    >
      <Spinner size="lg" />
    </div>
  );
}
