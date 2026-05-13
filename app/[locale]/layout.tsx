import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { locales } from "@/lib/i18n/config";
import { ThemeProvider } from "@/lib/theme/theme-provider";
import { AuthProvider } from "@/lib/auth/auth-context";
import { Analytics } from "@vercel/analytics/next";
import { Toaster } from "@/components/ui/toaster";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });

  // Determine the base URL (use environment variable or default)
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://chilltour.com";

  // Generate canonical URL
  const canonicalPath = locale === "en" ? "/" : `/${locale}`;
  const canonical = `${baseUrl}${canonicalPath}`;

  return {
    title: t("title"),
    description: t("description"),
    icons: {
      icon: "/logo.svg",
    },
    metadataBase: new URL(baseUrl),
    alternates: {
      canonical: canonicalPath,
      languages: {
        en: "/",
        "zh-TW": "/zh-TW",
      },
    },
    openGraph: {
      title: t("title"),
      description: t("description"),
      url: canonical,
      siteName: "ChillTour",
      locale: locale,
      alternateLocale: locale === "en" ? "zh-TW" : "en",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: t("title"),
      description: t("description"),
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Validate locale - return 404 for unsupported locales
  if (!(locales as readonly string[]).includes(locale)) {
    notFound();
  }

  // Load messages for the locale
  const messages = await getMessages();

  return (
    <>
      <Analytics />
      <NextIntlClientProvider messages={messages}>
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
          <Toaster />
        </ThemeProvider>
      </NextIntlClientProvider>
    </>
  );
}
