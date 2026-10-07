import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Babyscan Clinic — Receipt Generator",
  description: "Cloud Receipt Generator for Babyscan Fetal Medicine & Gynae Imaging Clinic",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      "max-video-preview": -1,
      "max-image-preview": "none",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <meta name="robots" content="noindex, nofollow, noarchive, nosnippet" />
        <meta name="googlebot" content="noindex, nofollow, noarchive, nosnippet" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#1565c0" />
      </head>
      <body className="antialiased min-h-screen bg-slate-50 text-slate-800">
        {children}
      </body>
    </html>
  );
}
