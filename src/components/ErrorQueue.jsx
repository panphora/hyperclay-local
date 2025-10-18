import React, { useState, useEffect } from 'react';

const ERROR_PRIORITY = {
  CRITICAL: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4
};

const ERROR_COLORS = {
  1: 'bg-red-600 text-white border-red-700',
  2: 'bg-red-500 text-white border-red-600',
  3: 'bg-red-400 text-white border-red-500',
  4: 'bg-red-300 text-white border-red-400'
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
    <div className="fixed top-20 right-4 z-50 space-y-2 max-w-md">
      {visibleErrors.map(error => (
        <div
          key={error.id}
          className={`
            p-4 rounded-lg shadow-lg border-2 transition-all
            ${ERROR_COLORS[error.priority]}
            ${error.priority === ERROR_PRIORITY.CRITICAL ? 'animate-pulse' : ''}
          `}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 font-semibold">
                <span>
                  {error.priority === ERROR_PRIORITY.CRITICAL ? 'Critical Error' :
                   error.priority === ERROR_PRIORITY.HIGH ? 'Error' :
                   error.priority === ERROR_PRIORITY.MEDIUM ? 'Warning' :
                   'Info'}
                </span>
                {error.file && (
                  <span className="text-sm opacity-75">
                    ({error.file})
                  </span>
                )}
              </div>

              <div className="mt-2 text-sm">
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

              {error.timestamp && (
                <div className="mt-2 text-xs opacity-60">
                  {new Date(error.timestamp).toLocaleTimeString()}
                </div>
              )}
            </div>

            {error.dismissable && (
              <button
                onClick={() => onDismiss(error.id)}
                className="ml-4 text-2xl hover:opacity-70 transition-opacity"
                title="Dismiss"
              >
                ×
              </button>
            )}
          </div>
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