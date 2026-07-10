import type { Metadata } from "next";
import { Cormorant_Garamond, Outfit } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const silverSouth = localFont({
  src: "../public/fonts/silver-south-script.ttf",
  variable: "--font-silver-south",
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LUX International",
  description: "LUX International Gallery Viewer",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${silverSouth.variable} ${cormorant.variable} ${outfit.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#EEE8E0] text-[#2C2520]">{children}</body>
    </html>
  );
}
