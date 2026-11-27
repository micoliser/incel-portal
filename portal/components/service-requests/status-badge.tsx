import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS, type RequestStatus } from "@/lib/api/service-requests";

const VARIANTS: Record<RequestStatus, "default" | "success" | "warning" | "destructive" | "secondary"> = {
  submitted: "default",
  pending_approval: "warning",
  approved: "default",
  rejected: "destructive",
  completed: "success",
  cancelled: "secondary",
};

export function RequestStatusBadge({ status, stage }: { status: RequestStatus; stage?: "" | "first" | "final" }) {
  const label =
    status === "pending_approval" && stage === "final"
      ? "Pending final approval"
      : status === "pending_approval" && stage === "first"
        ? "Pending first approval"
        : STATUS_LABELS[status];
  return <Badge variant={VARIANTS[status]}>{label}</Badge>;
}
