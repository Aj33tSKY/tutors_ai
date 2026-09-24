import type { Metadata, Viewport } from "next";
import { Host_Grotesk, Roboto_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// One friendly variable sans for both body copy and headings — mono is kept
// only for tabular numbers (timers, percentages, prices).
const hostGrotesk = Host_Grotesk({
  variable: "--font-body",
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
});

const robotoMono = Roboto_Mono({
  variable: "--font-mono-stack",
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Kindling — A-Level STEM Tutoring, Grounded in Every Session",
    template: "%s · Kindling",
  },
  description:
    "UK A-Level Maths, Further Maths, Physics, Chemistry, Biology and Computing tutoring. Live sessions, automatic topic mapping, and an AI revision assistant grounded in your own tutor's words.",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${hostGrotesk.variable} ${robotoMono.variable} h-full`}
    >
      <head>
        <noscript>
          {/* Scroll reveals are inline opacity:0 until the observer runs. */}
          <style>{`[data-reveal]{opacity:1!important;transform:none!important}`}</style>
        </noscript>
      </head>
      <body className="flex min-h-full flex-col text-foreground">
        <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
