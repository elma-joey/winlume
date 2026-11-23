"use client";

import { type MouseEvent, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/scrollLock";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  label: string;
  align?: "center" | "top";
  size?: "default" | "workspace" | "onboarding" | "overlay" | "drawer" | "sheet";
  children: ReactNode;
}

// 全局打开栈：后打开的 modal 获得更高层级，ESC 只关闭最上层。
const modalStack: string[] = [];
let nextModalId = 0;
let nextZIndex = 100;

const EXIT_DURATION = 150;

const subscribeToPortalTarget = () => () => {};
const getPortalTarget = (): HTMLElement => document.body;
const getServerPortalTarget = (): null => null;

export default function Modal({
  open,
  onClose,
  label,
  align = "center",
  size = "default",
  children,
}: ModalProps) {
  const [id] = useState(() => `modal-${nextModalId++}`);
  const [rendered, setRendered] = useState(open);
  const portalTarget = useSyncExternalStore<HTMLElement | null>(
    subscribeToPortalTarget,
    getPortalTarget,
    getServerPortalTarget,
  );
  const hostRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  // 在 effect 中同步最新 onClose，避免渲染期写 ref
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // 渲染期间同步打开状态
  if (open && !rendered) setRendered(true);
  const closing = rendered && !open;
  const active = rendered && portalTarget !== null;

  // 关闭动画结束后再卸载
  useEffect(() => {
    if (open || !rendered) return;
    const timer = window.setTimeout(() => setRendered(false), EXIT_DURATION);
    return () => window.clearTimeout(timer);
  }, [open, rendered]);

  // 打开期间：分配层级（后打开者恒在上）、登记栈、锁定背景滚动、ESC 只关最上层
  useEffect(() => {
    if (!active) return;
    const zIndex = nextZIndex;
    nextZIndex += 2;
    if (hostRef.current) hostRef.current.style.zIndex = String(zIndex);
    modalStack.push(id);
    lockBodyScroll();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && modalStack[modalStack.length - 1] === id) {
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      const index = modalStack.indexOf(id);
      if (index !== -1) modalStack.splice(index, 1);
      unlockBodyScroll();
      document.removeEventListener("keydown", onKey);
    };
  }, [active, id]);

  useFocusTrap(panelRef, active, () => modalStack[modalStack.length - 1] === id, size !== "sheet");

  if (!active) return null;

  function closeOnBackdrop(event: MouseEvent<HTMLElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return createPortal(
    <div
      ref={hostRef}
      className={`fixed inset-0 ${closing ? "pointer-events-none" : ""}`}
    >
      <div
        className={`modal-backdrop absolute inset-0 overflow-y-auto ${
          size === "overlay" ? "bg-ink-950/40" : "bg-ink-950/35"
        } ${closing ? "modal-fade-out" : "modal-fade-in"}`}
        onMouseDown={closeOnBackdrop}
      >
        <div
          className={`flex min-h-full w-full ${size === "drawer" ? "" : "justify-center"} ${
            size === "drawer" ? "justify-start" : size === "sheet" ? "items-end" :
              size === "overlay" ? "items-center px-[5vw] py-[6vh]" : "p-4"
          }`}
          onMouseDown={closeOnBackdrop}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            tabIndex={-1}
            className={`w-full outline-none focus:outline-none focus-visible:outline-none ${
              size === "drawer"
                ? "flex h-dvh max-w-[min(87vw,360px)] flex-col"
                : size === "sheet"
                  ? "max-w-none"
                  : size === "overlay"
                ? "flex h-[min(84dvh,56rem)] flex-col"
                : align === "top"
                  ? "mt-[10dvh] mb-4"
                  : "my-auto"
            } ${closing ? "modal-pop-out" : "modal-pop"} ${
              size === "drawer" || size === "sheet"
                ? ""
                : size === "overlay"
                ? "max-w-none"
                : size === "workspace"
                  ? "max-w-6xl"
                  : size === "onboarding"
                    ? "max-w-4xl"
                    : "max-w-md"
            }`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {children}
          </div>
        </div>
      </div>
    </div>,
    portalTarget,
  );
}

export function ModalCloseButton({ onClose, className }: { onClose: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="关闭"
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-lg text-ink-400 transition hover:bg-canvas hover:text-ink-700",
        className,
      )}
    >
      <X className="h-4 w-4" />
    </button>
  );
}
