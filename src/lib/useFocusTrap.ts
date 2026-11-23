import { useEffect, useRef, type RefObject } from "react";

const focusableSelector =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 弹层焦点管理：激活时把焦点移入容器（优先输入框），
 * Tab / Shift+Tab 在容器内循环，退出后把焦点还给之前的元素。
 * isTopmost 用于多弹层堆叠时只让最上层的陷阱生效。
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  isTopmost: () => boolean = () => true,
  preferInput = true,
) {
  const isTopmostRef = useRef(isTopmost);
  // 在 effect 中同步最新判断函数，避免渲染期写 ref
  useEffect(() => {
    isTopmostRef.current = isTopmost;
  });

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(focusableSelector));

    const initial =
      (preferInput ? container.querySelector<HTMLElement>("input:not([disabled]), textarea:not([disabled])") : null) ??
      focusables()[0] ??
      container;
    initial.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !isTopmostRef.current()) return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (event.shiftKey) {
        if (current === first || !container.contains(current)) {
          event.preventDefault();
          last.focus();
        }
      } else if (current === last || !container.contains(current)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [active, containerRef, preferInput]);
}
