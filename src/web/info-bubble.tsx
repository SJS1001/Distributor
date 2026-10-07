import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const openEvent = "distributor-info-bubble-open";

// Section guidance behind an (i) button. Click toggles; an outside click or
// Escape closes it. Only one bubble is open at a time.
export function InfoBubble({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId(),
    [open, setOpen] = useState(false),
    [position, setPosition] = useState<{ top: number; left: number } | null>(
      null,
    ),
    wrapper = useRef<HTMLSpanElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const button = trigger.current?.getBoundingClientRect(),
      box = panel.current?.getBoundingClientRect();
    if (!button || !box) return;
    const margin = 12,
      below = button.bottom + 8,
      top =
        below + box.height > window.innerHeight - margin &&
        button.top - 8 - box.height > margin
          ? button.top - 8 - box.height
          : below,
      left = Math.min(
        Math.max(button.left - 14, margin),
        window.innerWidth - box.width - margin,
      );
    setPosition({ top, left: Math.max(left, margin) });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
    else setPosition(null);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const others = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) setOpen(false);
    };
    const outside = (event: MouseEvent | TouchEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener(openEvent, others);
    document.addEventListener("mousedown", outside);
    document.addEventListener("touchstart", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener(openEvent, others);
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("touchstart", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, id, place]);

  return (
    <span className="info-bubble" ref={wrapper}>
      <button
        ref={trigger}
        type="button"
        className="info-bubble-trigger"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          if (!open)
            document.dispatchEvent(new CustomEvent(openEvent, { detail: id }));
          setOpen(!open);
        }}
      >
        <span aria-hidden="true">i</span>
      </button>
      {open && (
        <span
          id={id}
          ref={panel}
          className="info-bubble-panel"
          style={
            position
              ? { top: position.top, left: position.left }
              : { visibility: "hidden" }
          }
        >
          {children}
        </span>
      )}
    </span>
  );
}
