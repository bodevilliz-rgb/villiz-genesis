import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Villiz Social Manager",
    template: "%s · Villiz Social Manager",
  },
  description: "Project Genesis — the operational platform Villiz runs client social media on.",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#08090a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "var(--card)",
              border: "1px solid var(--border-strong)",
              color: "var(--foreground)",
            },
          }}
        />
      </body>
    </html>
  );
}
