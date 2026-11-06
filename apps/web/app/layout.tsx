import type { Metadata, Viewport } from "next";
import { Geist_Mono, Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], weight: ["200", "300", "400", "500", "600", "700", "800"], variable: "--font-manrope" });
const geistMono = Geist_Mono({ subsets: ["latin"], weight: ["200", "300", "400", "500", "600", "700", "800"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Leash: onchain mandates for AI agent wallets",
  description:
    "Your agent will get prompt-injected. Your money won't move. Leash is a Solana program that only releases an agent's funds when an owner-signed authorization covers the payment.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "Leash: onchain mandates for AI agent wallets",
    description: "Caps limit how much you lose. Mandates decide whether you lose anything.",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#050303", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${geistMono.variable} w-full overflow-x-hidden`}>
      <body className="w-full overflow-x-clip">{children}</body>
    </html>
  );
}
