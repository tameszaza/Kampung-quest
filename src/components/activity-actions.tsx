import Link from "next/link";
import { Icon } from "@/components/icons";

/** Quest decisions are server-owned. This legacy card action only opens the
 * authoritative detail/formation view; it never records acceptance locally. */
export function ActivityActions({ activityId }: { activityId: string; acceptOnly?: boolean }) {
  return <div className="activity-actions accept-only"><Link className="primary-button" href={`/quests/${activityId}`}>Review activity <Icon name="chevron" size={18} /></Link></div>;
}
