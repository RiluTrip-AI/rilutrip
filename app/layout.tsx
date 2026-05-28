import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "RiluTrip",
  description: "AI-Powered Travel Planner",
};

/**
 * Root Layout
 *
 * Provides the required <html> and <body> tags (Next.js 16 enforces this at
 * the root). Locale-specific providers live in app/[locale]/layout.tsx.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
