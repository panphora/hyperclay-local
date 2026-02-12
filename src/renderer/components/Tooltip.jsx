import React, { useId, useMemo, useRef, useState } from 'react';
import {
  useFloating,
  offset,
  flip,
  shift,
  arrow,
  autoUpdate,
  useHover,
  useFocus,
  useDismiss,
  useRole,
  useInteractions,
  FloatingPortal,
  FloatingArrow,
  safePolygon
} from '@floating-ui/react';

function mergeRefs(...refs) {
  return (node) => {
    refs.forEach((ref) => {
      if (typeof ref === 'function') ref(node);
      else if (ref && 'current' in ref) ref.current = node;
    });
  };
}

export default function Tooltip({
  children,
  label,
  placement = 'bottom',
  openDelay = 80,
  closeDelay = 0,
  disabled = false
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const arrowRef = useRef(null);

  const ARROW_HEIGHT = 7;

  const middleware = useMemo(() => [
    offset(ARROW_HEIGHT),
    flip(),
    shift({ padding: 8 }),
    arrow({ element: arrowRef })
  ], []);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    middleware,
    whileElementsMounted: autoUpdate
  });

  const hover = useHover(context, { enabled: !disabled, handleClose: safePolygon(), delay: { open: openDelay, close: closeDelay } });
  const focus = useFocus(context, { enabled: !disabled });
  const dismiss = useDismiss(context, { enabled: !disabled });
  const role = useRole(context, { role: 'tooltip' });

  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  const child = React.Children.only(children);

  return (
    <>
      {React.cloneElement(
        child,
        getReferenceProps({
          ...child.props,
          ref: mergeRefs(child.ref, refs.setReference),
          'aria-describedby': open ? id : undefined
        })
      )}

      {open && !disabled && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{ ...floatingStyles, zIndex: 1000 }}
            {...getFloatingProps({ id })}
            className="bg-[#1D1F2F] border-2 border-[#4F5A97] px-3 py-1 text-sm text-white max-w-[calc(100vw-32px)] break-all"
          >
            {label}
            <FloatingArrow
              ref={arrowRef}
              context={context}
              width={14}
              height={7}
              fill="#1D1F2F"
              strokeWidth={2}
              stroke="#4F5A97"
            />
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
