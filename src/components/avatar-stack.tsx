import Image from "next/image";

const avatars = [
  "/assets/profile-anne.jpg",
  "/assets/profile-david.jpg",
  "/assets/profile-maria.jpg",
];

export function AvatarStack({ count = 3 }: { count?: number }) {
  return (
    <span className="avatar-stack" aria-label={`${count} members joined`}>
      {avatars.slice(0, count).map((src, index) => (
        <span key={src} className="stack-avatar" style={{ zIndex: count - index }}>
          <Image src={src} alt="" fill sizes="28px" />
        </span>
      ))}
    </span>
  );
}
