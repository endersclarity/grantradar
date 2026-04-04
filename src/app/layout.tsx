import type { Metadata } from "next";
import { Inter, DM_Serif_Display } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const dmSerif = DM_Serif_Display({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "GrantRadar — Free Grant Alerts for California Nonprofits",
  description: "Get a free weekly email with CA state grants matched to your nonprofit. Powered by the CA Grants Portal, updated daily.",
  openGraph: {
    title: "GrantRadar — Free Grant Alerts for California Nonprofits",
    description: "Weekly email digest of CA state grants matched to your nonprofit by category and geography. Free forever.",
    type: "website",
    url: "https://grantradar-sable.vercel.app",
    siteName: "GrantRadar",
  },
  twitter: {
    card: "summary_large_image",
    title: "GrantRadar — Free Grant Alerts for CA Nonprofits",
    description: "Weekly email digest of CA state grants matched to your nonprofit. Free forever.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${dmSerif.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <footer className="border-t mt-auto">
          <div className="max-w-4xl mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
            <p>Powered by <a href="https://www.grants.ca.gov/" className="underline hover:text-foreground" target="_blank" rel="noopener">CA Grants Portal</a> data, updated daily.</p>
            <p className="mt-1">Built by a California nonprofit development director who got tired of checking the portal manually.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
