import { redirect } from "next/navigation";

/**
 * Redirect legacy shared-summary links to the public shared summary page.
 */
export default async function SharedSummaryRedirect({
  searchParams,
}: {
  searchParams?: { token?: string };
}) {
  const shareToken = searchParams?.token;

  if (shareToken) {
    redirect(`/shared-summary-view?token=${shareToken}`);
  }

  redirect("/shared-summary-view");
}
