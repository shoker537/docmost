import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import classes from "./overlay-scrollbars.module.css";

type Axis = "x" | "y";
type Geometry = {
  left: number;
  top: number;
  length: number;
  thumb: number;
  offset: number;
  max: number;
  position: number;
};

function getScrollers(target: Element): HTMLElement[] {
  const scrollers: HTMLElement[] = [];
  for (let element = target; element; element = element.parentElement) {
    if (!(element instanceof HTMLElement)) continue;
    // Mantine already draws overlay scrollbars for these viewports.
    if (element.classList.contains("mantine-ScrollArea-viewport")) continue;
    const style = getComputedStyle(element);
    if (
      (/auto|scroll/.test(style.overflowY) &&
        element.scrollHeight > element.clientHeight) ||
      (/auto|scroll/.test(style.overflowX) &&
        element.scrollWidth > element.clientWidth)
    )
      scrollers.push(element);
  }
  const page = document.scrollingElement;
  if (
    page instanceof HTMLElement &&
    !scrollers.includes(page) &&
    (page.scrollHeight > page.clientHeight ||
      page.scrollWidth > page.clientWidth)
  ) {
    scrollers.push(page);
  }
  return scrollers;
}

function measure(element: HTMLElement, axis: Axis): Geometry | null {
  if (!element.isConnected) return null;
  const page = element === document.scrollingElement;
  const rect = element.getBoundingClientRect();
  let left = page ? 0 : rect.left + element.clientLeft;
  let top = page ? 0 : rect.top + element.clientTop;
  let right = page
    ? document.documentElement.clientWidth
    : left + element.clientWidth;
  let bottom = page ? window.innerHeight : top + element.clientHeight;

  // Keep fixed overlays inside every clipping ancestor, including nested panels.
  for (
    let parent = element.parentElement;
    parent && parent !== document.body;
    parent = parent.parentElement
  ) {
    const style = getComputedStyle(parent);
    const bounds = parent.getBoundingClientRect();
    if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
      left = Math.max(left, bounds.left + parent.clientLeft);
      right = Math.min(
        right,
        bounds.left + parent.clientLeft + parent.clientWidth,
      );
    }
    if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
      top = Math.max(top, bounds.top + parent.clientTop);
      bottom = Math.min(
        bottom,
        bounds.top + parent.clientTop + parent.clientHeight,
      );
    }
  }
  left = Math.max(0, left);
  top = Math.max(0, top);
  right = Math.min(window.innerWidth, right);
  bottom = Math.min(window.innerHeight, bottom);
  const viewport = axis === "y" ? element.clientHeight : element.clientWidth;
  const content = axis === "y" ? element.scrollHeight : element.scrollWidth;
  const max = content - viewport;
  const length = (axis === "y" ? bottom - top : right - left) - 8;
  if (max <= 1 || length < 24 || right - left < 12 || bottom - top < 12)
    return null;
  const rtl = axis === "x" && getComputedStyle(element).direction === "rtl";
  const position = Math.max(
    0,
    Math.min(
      max,
      axis === "y"
        ? element.scrollTop
        : rtl
          ? max + element.scrollLeft
          : element.scrollLeft,
    ),
  );
  const thumb = Math.min(length, Math.max(28, (length * viewport) / content));
  return {
    left: axis === "y" ? right - 9 : left + 4,
    top: axis === "y" ? top + 4 : bottom - 9,
    length,
    thumb,
    offset: (position / max) * (length - thumb),
    max,
    position,
  };
}

function setPosition(element: HTMLElement, axis: Axis, value: number) {
  if (axis === "y") element.scrollTop = value;
  else
    element.scrollLeft =
      getComputedStyle(element).direction === "rtl"
        ? value - (element.scrollWidth - element.clientWidth)
        : value;
}

function Scrollbar({
  element,
  axis,
  controls,
}: {
  element: HTMLElement;
  axis: Axis;
  controls: string;
}) {
  const { t } = useTranslation();
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const drag = useRef<{ coordinate: number; position: number } | null>(null);

  useLayoutEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setGeometry(measure(element, axis)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [element, axis]);

  if (!geometry) return null;
  const vertical = axis === "y";
  const coordinate = (event: PointerEvent) =>
    vertical ? event.clientY : event.clientX;
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const current = measure(element, axis);
    if (!current) return;
    let position = current.position;
    if (event.target === event.currentTarget) {
      const start = vertical ? current.top : current.left;
      position = Math.max(
        0,
        Math.min(
          current.max,
          ((coordinate(event) - start - current.thumb / 2) /
            (current.length - current.thumb)) *
            current.max,
        ),
      );
      setPosition(element, axis, position);
    }
    drag.current = { coordinate: coordinate(event), position };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const current = measure(element, axis);
    if (!current || current.length <= current.thumb) return;
    setPosition(
      element,
      axis,
      Math.max(
        0,
        Math.min(
          current.max,
          drag.current.position +
            ((coordinate(event) - drag.current.coordinate) * current.max) /
              (current.length - current.thumb),
        ),
      ),
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const pageSize = vertical ? element.clientHeight : element.clientWidth;
    const changes: Record<string, number> = {
      [vertical ? "ArrowDown" : "ArrowRight"]: 40,
      [vertical ? "ArrowUp" : "ArrowLeft"]: -40,
      PageDown: pageSize,
      PageUp: -pageSize,
      Home: -geometry.max,
      End: geometry.max,
    };
    if (!(event.key in changes)) return;
    event.preventDefault();
    setPosition(
      element,
      axis,
      Math.max(
        0,
        Math.min(geometry.max, geometry.position + changes[event.key]),
      ),
    );
  };

  return (
    <div
      className={classes.track}
      data-axis={axis}
      data-overlay-scrollbar
      role="scrollbar"
      aria-label={vertical ? t("Scroll vertically") : t("Scroll horizontally")}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-controls={controls}
      aria-valuemin={0}
      aria-valuemax={Math.round(geometry.max)}
      aria-valuenow={Math.round(geometry.position)}
      tabIndex={0}
      style={{
        left: geometry.left,
        top: geometry.top,
        [vertical ? "height" : "width"]: geometry.length,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onPointerUp={(event) => {
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onKeyDown={onKeyDown}
    >
      <div
        className={classes.thumb}
        style={{
          [vertical ? "height" : "width"]: geometry.thumb,
          transform: `translate${vertical ? "Y" : "X"}(${geometry.offset}px)`,
        }}
      />
    </div>
  );
}

function ScrollerBars({ element }: { element: HTMLElement }) {
  const generatedId = useId();
  const controls = element.id || generatedId;
  useLayoutEffect(() => {
    if (element.id) return;
    element.setAttribute("id", controls);
    return () => {
      if (element.id === controls) element.removeAttribute("id");
    };
  }, [element, controls]);
  return (
    <>
      <Scrollbar element={element} axis="y" controls={controls} />
      <Scrollbar element={element} axis="x" controls={controls} />
    </>
  );
}

/** Decorate native scrolling without wrappers, gutters, or changing scroll refs. */
export default function OverlayScrollbars() {
  const [elements, setElements] = useState<HTMLElement[]>([]);
  useEffect(() => {
    document.documentElement.classList.add("overlay-scrollbars");
    const activate = (event: Event) => {
      const target =
        event.target === document ? document.scrollingElement : event.target;
      if (
        !(target instanceof Element) ||
        target.closest("[data-overlay-scrollbar]")
      )
        return;
      const next = getScrollers(target);
      setElements((previous) => {
        // A parent's scroll must not unmount its thumb during pointer capture.
        if (event.type === "scroll" && previous.includes(target as HTMLElement))
          return previous;
        return next.length === previous.length &&
          next.every((element, index) => element === previous[index])
          ? previous
          : next;
      });
    };
    document.addEventListener("pointerover", activate, { passive: true });
    document.addEventListener("focusin", activate);
    document.addEventListener("scroll", activate, {
      capture: true,
      passive: true,
    });
    return () => {
      document.documentElement.classList.remove("overlay-scrollbars");
      document.removeEventListener("pointerover", activate);
      document.removeEventListener("focusin", activate);
      document.removeEventListener("scroll", activate, true);
    };
  }, []);
  return createPortal(
    <div className={classes.layer}>
      {elements.map((element, index) => (
        <ScrollerBars key={index} element={element} />
      ))}
    </div>,
    document.body,
  );
}
