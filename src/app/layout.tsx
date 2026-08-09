import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ServiceAudit Agent — AI Car Service Advisor",
  description:
    "An AI agent that checks your VIN and mileage against the manufacturer maintenance schedule to tell you what's actually due — before you pay a dealership.",
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
