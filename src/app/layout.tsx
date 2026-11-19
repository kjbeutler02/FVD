import type { Metadata } from "next";
import { Manrope, Source_Serif_4, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Design-system faces (placeholders until licensed brand fonts are supplied):
// Manrope for all UI, Source Serif 4 for editorial moments, IBM Plex Mono for
// identifiers (project numbers, file names of archives, sizes, counts).
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Strong & Hanni — Project Documents",
  description:
    "Authorized firm personnel only. Browse and download Strong & Hanni matter documents from Filevine.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${sourceSerif.variable} ${plexMono.variable} h-full`}
    >
      <body className="flex min-h-full flex-col bg-workspace text-ink">
        {children}
      </body>
    </html>
  );
}
