import { LoadingSpinner } from "@/components/LoadingSpinner";

export default function Loading() {
  return (
    <div style={{ display: "flex", minHeight: "50vh", alignItems: "center", justifyContent: "center" }}>
      <LoadingSpinner size="lg" />
    </div>
  );
}
