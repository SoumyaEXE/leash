import type { Metadata, Viewport } from "next";
import { Geist_Mono, Manrope } from "next/font/google";
import { SmoothScroll } from "@/components/cx/smooth-scroll";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-manrope" });
const geistMono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Leash · Onchain mandates for AI agent wallets",
  description:
    "Your agent will get prompt-injected. Your money won't move. Leash is a Solana program that only releases an agent's funds when an owner-signed authorization covers the payment.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "Leash · Onchain mandates for AI agent wallets",
    description: "Caps limit how much you lose. Mandates decide whether you lose anything.",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#000000", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${geistMono.variable} w-full`}>
      <body className="w-full overflow-x-clip">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <SmoothScroll />
        {children}
      </body>
    </html>
  );
}
