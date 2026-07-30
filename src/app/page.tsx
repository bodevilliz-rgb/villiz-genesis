import { redirect } from "next/navigation";
import { routes } from "@/lib/routes";

export default function RootPage() {
  redirect(routes.dashboard);
}
