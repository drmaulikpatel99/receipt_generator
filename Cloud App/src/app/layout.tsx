import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Babyscan Clinic — Receipt Generator",
  description: "Cloud Receipt Generator for Babyscan Fetal Medicine & Gynae Imaging Clinic",
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
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#1565c0" />
      </head>
      <body className="antialiased min-h-screen bg-slate-50 text-slate-800">
        {children}
      </body>
    </html>
  );
}
