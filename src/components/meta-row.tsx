import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";

export function MetaRow({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="meta-row">
      <Icon name={icon} size={18} />
      <span>{children}</span>
    </div>
  );
}
