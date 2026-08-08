import Image from "next/image";

export function KampungLogo({ size = 40, className = "", priority = false }: { size?: number; className?: string; priority?: boolean }) {
  return <Image
    className={`kampung-logo${className ? ` ${className}` : ""}`}
    src="/assets/kampungLogo.svg"
    alt=""
    aria-hidden="true"
    width={size}
    height={size}
    sizes={`${size}px`}
    priority={priority}
  />;
}
