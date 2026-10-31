import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

/** Native content scrolling with a fixed-size, keyboard-accessible thumb. */
export function ConversationScroll({
  children,
  viewportRef,
}: {
  children: ReactNode;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const id = useId();
  const content = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; top: number } | null>(null);
  const [metrics, setMetrics] = useState({ height: 0, max: 0, top: 0 });
  const measure = () => {
    const el = viewportRef.current;
    if (!el) return;
    const next = {
      height: el.clientHeight,
      max: Math.max(0, el.scrollHeight - el.clientHeight),
      top: el.scrollTop,
    };
    setMetrics((previous) =>
      previous.height === next.height && previous.max === next.max && previous.top === next.top
        ? previous
        : next,
    );
  };
  useLayoutEffect(measure, [children]);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(measure);
    if (viewportRef.current) observer.observe(viewportRef.current);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, [viewportRef]);
  const thumb = Math.min(96, metrics.height);
  const travel = Math.max(0, metrics.height - thumb);
  const move = (top: number) => {
    const el = viewportRef.current;
    if (el) {
      el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, top));
      measure();
    }
  };
  return (
    <div className="conversation-shell">
      <div className="conversation" id={id} ref={viewportRef} onScroll={measure}>
        <div ref={content} className="conversation-content">
          {children}
        </div>
      </div>
      <div
        className="conversation-scrollbar"
        ref={track}
        role="scrollbar"
        aria-label="聊天历史滚动条"
        aria-controls={id}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={Math.ceil(metrics.max)}
        aria-valuenow={Math.round(metrics.top)}
        tabIndex={metrics.max > 0 ? 0 : -1}
        hidden={metrics.max <= 0}
        onWheel={(event) => move(metrics.top + event.deltaY)}
        onPointerDown={(event) => {
          if (event.button !== 0 || !track.current || travel <= 0) return;
          event.preventDefault();
          const y = event.clientY - track.current.getBoundingClientRect().top;
          const start = metrics.max ? (metrics.top / metrics.max) * travel : 0;
          const top =
            y >= start && y <= start + thumb ? metrics.top : ((y - thumb / 2) / travel) * metrics.max;
          move(top);
          drag.current = { y: event.clientY, top: Math.max(0, Math.min(metrics.max, top)) };
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current && travel > 0)
            move(drag.current.top + ((event.clientY - drag.current.y) / travel) * metrics.max);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          const steps: Record<string, number> = {
            ArrowDown: 40,
            ArrowUp: -40,
            PageDown: metrics.height * 0.9,
            PageUp: -metrics.height * 0.9,
          };
          if (event.key in steps || event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            move(
              event.key === 'Home' ? 0 : event.key === 'End' ? metrics.max : metrics.top + steps[event.key],
            );
          }
        }}
      >
        <div
          className="conversation-scroll-thumb"
          style={{ height: thumb, top: metrics.max ? (metrics.top / metrics.max) * travel : 0 }}
        />
      </div>
    </div>
  );
}
