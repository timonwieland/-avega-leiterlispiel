import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AVEGA Leiterspiel – 10 Jahre in 100 Feldern",
  description: "Das AVEGA Leiterspiel als gemeinsames Online-Multiplayer-Erlebnis.",
  icons: {
    icon: "/assets/avega-signet.svg",
    shortcut: "/assets/avega-signet.svg",
  },
  openGraph: { title: "10 Jahre avega – Das Online-Leiterspiel", description: "Gemeinsam würfeln und zehn Jahre AVEGA entdecken.", images: ["/og.png"] },
  twitter: { card: "summary_large_image", title: "10 Jahre avega – Das Online-Leiterspiel", description: "Gemeinsam würfeln und zehn Jahre AVEGA entdecken.", images: ["/og.png"] },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
