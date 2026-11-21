import type { Metadata, Viewport } from "next";
import CloudChat from "./CloudChat";

export const metadata: Metadata = { title: "云会话 · Reizo" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function CloudChatPage() {
  return <CloudChat />;
}
