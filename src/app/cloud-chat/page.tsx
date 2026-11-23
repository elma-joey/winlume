import type { Metadata, Viewport } from "next";
import CloudChat from "./CloudChat";

export const metadata: Metadata = {
  title: "云会话 · Reizo Studio",
  manifest: "/cloud-chat.webmanifest",
  icons: {
    icon: "/reizo/assets/reizo-mark.png",
    apple: { url: "/reizo/assets/reizo-app-180.png", sizes: "180x180", type: "image/png" },
  },
  appleWebApp: { capable: true, title: "Reizo Studio", statusBarStyle: "default" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function CloudChatPage() {
  return <CloudChat />;
}
