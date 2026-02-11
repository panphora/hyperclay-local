import React, { useState, useEffect } from 'react';

function relativeTime(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function ErrorsPage({ errors, onMarkRead, onMarkErrorRead, onClearAll }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(interval);
  }, []);

  const sortedErrors = [...errors].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div>
      <div className="flex items-center gap-4 mb-5">
        <h1 className="text-[36px]">Errors</h1>
        <div className="ml-auto flex gap-2">
          <button
            className="group p-[4px_17px_7px] text-center text-[18px] cursor-pointer bg-[#1D1F2F] border-[3px] border-t-[#474C65] border-r-[#131725] border-b-[#131725] border-l-[#474C65] hover:bg-[#232639] active:border-b-[#474C65] active:border-l-[#131725] active:border-t-[#131725] active:border-r-[#474C65]"
            onClick={onMarkRead}
          >
            <span className="whitespace-nowrap select-none inline-block group-active:translate-x-[1.5px] group-active:translate-y-[1.5px]">
              mark as read
            </span>
          </button>
          <button
            className="group p-[4px_17px_7px] text-center text-[18px] cursor-pointer bg-[#7B2525] border-[3px] border-t-[#B45454] border-r-[#371111] border-b-[#371111] border-l-[#B45454] hover:bg-[#9F3030] active:border-b-[#B45454] active:border-l-[#371111] active:border-t-[#371111] active:border-r-[#B45454]"
            onClick={onClearAll}
          >
            <span className="whitespace-nowrap select-none inline-block group-active:translate-x-[1.5px] group-active:translate-y-[1.5px]">
              clear
            </span>
          </button>
        </div>
      </div>

      {sortedErrors.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-[18px] text-[#8A92BB]">
          No errors
        </div>
      ) : (
        <div className="flex flex-col max-h-[550px] overflow-y-auto">
          {sortedErrors.map(error => (
            <div
              key={error.id}
              className="flex gap-3 items-start p-3 border-b border-[#292F52] bg-[#1D1F2F]"
            >
              {!error.read ? (
                <button
                  className="shrink-0 mt-1.5 w-[8px] h-[8px] rounded-full bg-[#6B7280] hover:bg-[#9CA3AF] cursor-pointer"
                  onClick={() => onMarkErrorRead(error.id)}
                  title="Mark as read"
                />
              ) : (
                <div className="shrink-0 w-[8px]" />
              )}
              <div className="flex-1 min-w-0 text-[15px] text-[#D1D5E8] break-words">
                {error.error}
                {error.file && (
                  <div className="mt-1 text-[13px] text-[#8A92BB]">filename: {error.file}</div>
                )}
              </div>
              <div className="shrink-0 text-[13px] text-[#6B7280] tabular-nums">
                {relativeTime(error.timestamp)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
