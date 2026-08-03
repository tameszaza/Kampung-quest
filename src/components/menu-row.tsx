import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";

export function MenuRow({
  icon,
  label,
  href,
  danger = false,
  onClick,
  ariaExpanded,
}: {
  icon: IconName;
  label: string;
  href?: string;
  danger?: boolean;
  onClick?: () => void;
  ariaExpanded?: boolean;
}) {
  const className = `menu-row${danger ? " danger" : ""}`;
  const content = (
    <>
      <Icon name={icon} size={21} />
      <span>{label}</span>
      <Icon name="chevron" size={19} />
    </>
  );

  if (href) return <Link className={className} href={href}>{content}</Link>;
  return <button className={className} type="button" onClick={onClick} aria-expanded={ariaExpanded}>{content}</button>;
}
