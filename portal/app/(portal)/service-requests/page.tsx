import { redirect } from "next/navigation";

/** Service Requests opens on its first tab. The requests list will live here once it is built. */
export default function ServiceRequestsPage() {
  redirect("/service-requests/clients");
}
