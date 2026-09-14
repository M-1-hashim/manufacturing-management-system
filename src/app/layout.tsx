import type { Metadata, Viewport } from "next";
import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/500.css";
import "@fontsource/vazirmatn/600.css";
import "@fontsource/vazirmatn/700.css";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "سامانه مدیریت تولید | Afghan Manufacturing ERP",
  description:
    "سیستم جامع مدیریت چرخه تولید از مواد خام تا محصول نهایی و فروش — طراحی‌شده برای کارخانه‌های افغانستان",
  keywords: ["مدیریت تولید", "ERP", "افغانستان", "تولید", "انبار", "فروش"],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <link rel="preload" href="/fonts/B-Nazanin.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
      <body className="antialiased bg-background text-foreground">
        {children}
        <Toaster richColors closeButton />
      </body>
    </html>
  );
}
