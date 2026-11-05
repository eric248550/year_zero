import type { Metadata, Viewport } from "next";
import { I18nProvider } from "@/components/i18n";
import { getI18n } from "@/lib/i18n/server";
import "./globals.css";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: { default: "Genesis Studio", template: "%s · Genesis Studio" },
    description: t("meta.description"),
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0c0b",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await getI18n();
  return (
    <html lang={locale}>
      <body>
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
