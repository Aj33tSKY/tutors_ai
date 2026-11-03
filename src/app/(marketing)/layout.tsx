import localFont from "next/font/local";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

// A separate editorial voice for spoken excerpts; product UI remains in Geist.
const transcriptFont = localFont({
  src: "./fonts/newsreader-latin.woff2",
  variable: "--font-transcript",
  weight: "400",
  style: "normal",
  display: "swap",
  fallback: ["Georgia", "serif"],
});

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className={`${transcriptFont.variable} flex-1`}>{children}</main>
      <SiteFooter />
    </>
  );
}
