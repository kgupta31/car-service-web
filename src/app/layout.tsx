import type { Metadata } from "next";
import "./globals.css";
import { SITE_URL, SITE_TITLE, SITE_DESCRIPTION } from "@/lib/site";
import { Analytics } from "@vercel/analytics/next";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  manifest: "/manifest.json",
  keywords: [
    "is this car repair necessary",
    "am I being overcharged for car repair",
    "dealer maintenance upsell",
    "car maintenance schedule by VIN",
    "check dealer repair quote",
    "manufacturer maintenance schedule lookup",
  ],
  icons: {
    icon: "/logo.svg",
    apple: "/icons/icon-512.png",
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: "ServiceAudit Agent",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Analytics />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
