import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kampung Quest",
  description: "Safe, mutually beneficial community quest matchmaking.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
