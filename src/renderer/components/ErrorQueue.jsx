import React, { useState, useEffect } from 'react';

const ERROR_PRIORITY = {
  CRITICAL: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4
};

const ERROR_COLORS = {
  1: 'bg-red-600 text-white',
  2: 'bg-red-500 text-white',
  3: 'bg-red-400 text-white',
  4: 'bg-red-300 text-white'
};

export default function ErrorQueue({ errors, onDismiss, maxVisible = 3 }) {
  const [expandedErrors, setExpandedErrors] = useState(new Set());
  const [autoDismissTimers, setAutoDismissTimers] = useState({});

  // Sort errors by priority and timestamp
  const sortedErrors = [...errors].sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority; // Lower number = higher priority
    }
    return b.timestamp - a.timestamp; // Newer first
  });

  const visibleErrors = sortedErrors.slice(0, maxVisible);
  const hiddenCount = sortedErrors.length - maxVisible;

  // Auto-dismiss logic
  useEffect(() => {
    errors.forEach(error => {
      if (error.dismissable && !autoDismissTimers[error.id]) {
        const dismissTime =
          error.priority === ERROR_PRIORITY.HIGH ? 10000 :
          error.priority === ERROR_PRIORITY.MEDIUM ? 5000 :
          null;

        if (dismissTime) {
          const timer = setTimeout(() => {
            onDismiss(error.id);
          }, dismissTime);

          setAutoDismissTimers(prev => ({
            ...prev,
            [error.id]: timer
          }));
        }
      }
    });

    return () => {
      // Clear all timers on unmount
      Object.values(autoDismissTimers).forEach(clearTimeout);
    };
  }, [errors]);

  const toggleExpanded = (errorId) => {
    setExpandedErrors(prev => {
      const next = new Set(prev);
      if (next.has(errorId)) {
        next.delete(errorId);
      } else {
        next.add(errorId);
      }
      return next;
    });
  };

  if (errors.length === 0) return null;

  return (
    <div className="fixed top-20 right-4 z-50 space-y-2">
      {visibleErrors.map(error => (
        <div
          key={error.id}
          className={`
            w-fit max-w-[400px] px-4 py-2 shadow-lg relative
            ${ERROR_COLORS[error.priority]}
          `}
        >
          <div className="mr-4">
            <div className="text-sm">
              {expandedErrors.has(error.id) || error.error.length < 100
                ? error.error
                : error.error.substring(0, 100) + '...'}
            </div>

            {error.error.length > 100 && (
              <button
                onClick={() => toggleExpanded(error.id)}
                className="mt-2 text-xs underline opacity-75 hover:opacity-100"
              >
                {expandedErrors.has(error.id) ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
          <button
            onClick={() => onDismiss(error.id)}
            className="absolute top-[-6px] right-0 p-1.5 text-2xl leading-none hover:opacity-70 cursor-pointer"
            title="Dismiss"
          >
            ×
          </button>
        </div>
      ))}

      {hiddenCount > 0 && (
        <div className="p-3 bg-gray-200 text-gray-700 rounded-lg text-sm text-center">
          +{hiddenCount} more {hiddenCount === 1 ? 'error' : 'errors'}
        </div>
      )}
    </div>
  );
}