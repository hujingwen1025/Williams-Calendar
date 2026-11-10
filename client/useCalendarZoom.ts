import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

export const MIN_CALENDAR_ZOOM = 50;
export const MAX_CALENDAR_ZOOM = 400;
export const CALENDAR_ZOOM_STEP = 25;
export function clampCalendarZoom(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(
        MAX_CALENDAR_ZOOM,
        Math.max(
          MIN_CALENDAR_ZOOM,
          Math.round(value / CALENDAR_ZOOM_STEP) * CALENDAR_ZOOM_STEP,
        ),
      )
    : 100;
}

// Preserve the time under the pointer (or the viewport's center) when the
// timeline stretches. Use scroll geometry rather than private calendar classes.
export function useCalendarZoom(
  sheet: RefObject<HTMLElement | null>,
  zoom: number,
  onZoom: (value: number) => void,
  enabled: boolean,
) {
  const current = useRef(zoom);
  const callback = useRef(onZoom);
  const pending = useRef<{
    element: HTMLElement;
    ratio: number;
    offset: number;
  } | null>(null);
  current.current = zoom;
  callback.current = onZoom;
  const change = useRef((value: number, clientY?: number) => {
    const next = clampCalendarZoom(value);
    if (next === current.current) return;
    const root = sheet.current;
    if (root?.dataset.timeline === "true") {
      const scrollable = [...root.querySelectorAll<HTMLElement>("*")]
        .filter(
          (element) =>
            element.clientHeight > 40 &&
            element.scrollHeight > element.clientHeight + 1 &&
            /auto|scroll/.test(getComputedStyle(element).overflowY),
        )
        .sort(
          (a, b) =>
            b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth,
        )[0];
      if (scrollable) {
        const offset =
          clientY === undefined
            ? scrollable.clientHeight / 2
            : Math.max(
                0,
                Math.min(
                  scrollable.clientHeight,
                  clientY - scrollable.getBoundingClientRect().top,
                ),
              );
        pending.current = {
          element: scrollable,
          ratio: (scrollable.scrollTop + offset) / scrollable.scrollHeight,
          offset,
        };
      }
    }
    current.current = next;
    callback.current(next);
  }).current;

  useLayoutEffect(() => {
    const anchor = pending.current;
    if (!anchor) return;
    const frame = requestAnimationFrame(() => {
      if (anchor.element.isConnected)
        anchor.element.scrollTop =
          anchor.ratio * anchor.element.scrollHeight - anchor.offset;
      if (pending.current === anchor) pending.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [zoom]);

  useEffect(() => {
    const element = sheet.current;
    if (!element || !enabled) return;
    let wheelDelta = 0;
    let wheelTime = 0;
    let pinch: { distance: number; zoom: number } | null = null;
    let safariZoom: number | null = null;
    function wheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.cancelable) event.preventDefault();
      if (Date.now() - wheelTime > 200) wheelDelta = 0;
      wheelTime = Date.now();
      wheelDelta +=
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? element!.clientHeight
            : 1);
      if (Math.abs(wheelDelta) >= 12) {
        change(
          current.current +
            (wheelDelta < 0 ? CALENDAR_ZOOM_STEP : -CALENDAR_ZOOM_STEP),
          event.clientY,
        );
        wheelDelta = 0;
      }
    }
    const distance = (touches: TouchList) =>
      Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY,
      );
    function touchStart(event: TouchEvent) {
      if (event.touches.length !== 2) {
        pinch = null;
        return;
      }
      pinch = {
        distance: Math.max(1, distance(event.touches)),
        zoom: current.current,
      };
      if (event.cancelable) event.preventDefault();
    }
    function touchMove(event: TouchEvent) {
      if (event.touches.length !== 2 || !pinch) return;
      if (event.cancelable) event.preventDefault();
      change(
        (pinch.zoom * distance(event.touches)) / pinch.distance,
        (event.touches[0].clientY + event.touches[1].clientY) / 2,
      );
    }
    function touchEnd(event: TouchEvent) {
      if (event.touches.length !== 2) pinch = null;
    }
    function gestureStart(event: Event) {
      if (pinch) return;
      safariZoom = current.current;
      if (event.cancelable) event.preventDefault();
    }
    function gestureChange(event: Event) {
      if (pinch || safariZoom === null) return;
      if (event.cancelable) event.preventDefault();
      const gesture = event as Event & { scale?: number; clientY?: number };
      if (typeof gesture.scale === "number")
        change(safariZoom * gesture.scale, gesture.clientY);
    }
    function gestureEnd() {
      safariZoom = null;
    }
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("touchstart", touchStart, { passive: false });
    element.addEventListener("touchmove", touchMove, { passive: false });
    element.addEventListener("touchend", touchEnd);
    element.addEventListener("touchcancel", touchEnd);
    element.addEventListener("gesturestart", gestureStart, { passive: false });
    element.addEventListener("gesturechange", gestureChange, {
      passive: false,
    });
    element.addEventListener("gestureend", gestureEnd);
    return () => {
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("touchstart", touchStart);
      element.removeEventListener("touchmove", touchMove);
      element.removeEventListener("touchend", touchEnd);
      element.removeEventListener("touchcancel", touchEnd);
      element.removeEventListener("gesturestart", gestureStart);
      element.removeEventListener("gesturechange", gestureChange);
      element.removeEventListener("gestureend", gestureEnd);
    };
  }, [sheet, enabled, change]);
  return change;
}
