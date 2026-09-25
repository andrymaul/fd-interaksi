import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

export interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  totalItems?: number;
  itemLabel?: string;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  className?: string;
}

export const PaginationControls: React.FC<PaginationControlsProps> = ({
  currentPage,
  totalPages,
  totalItems,
  itemLabel = 'data',
  onPageChange,
  disabled = false,
  className = '',
}) => {
  const [jumpPage, setJumpPage] = useState<string>(currentPage.toString());

  useEffect(() => {
    setJumpPage(currentPage.toString());
  }, [currentPage]);

  const handlePageSelect = (e: React.MouseEvent, target: number) => {
    e.preventDefault();
    if (disabled || target < 1 || target > totalPages || target === currentPage) return;
    const currentY = window.scrollY;
    onPageChange(target);
    // Maintain current scroll position to avoid jump
    requestAnimationFrame(() => {
      window.scrollTo({ top: currentY, behavior: 'instant' });
    });
  };

  const handleJumpSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const parsed = parseInt(jumpPage, 10);
    if (!isNaN(parsed)) {
      const target = Math.max(1, Math.min(totalPages, parsed));
      if (target !== currentPage) {
        const currentY = window.scrollY;
        onPageChange(target);
        requestAnimationFrame(() => {
          window.scrollTo({ top: currentY, behavior: 'instant' });
        });
      }
      setJumpPage(target.toString());
    } else {
      setJumpPage(currentPage.toString());
    }
  };

  if (totalPages <= 1 && (!totalItems || totalItems <= 0)) {
    return null;
  }

  // Calculate visible page buttons (e.g. up to 5 surrounding pages)
  const getVisiblePages = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 4) {
        pages.push('...');
      }
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) pages.push(i);
      }
      if (currentPage < totalPages - 3) {
        pages.push('...');
      }
      if (!pages.includes(totalPages)) {
        pages.push(totalPages);
      }
    }
    return pages;
  };

  return (
    <div
      className={`bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs sm:text-sm text-slate-600 ${className}`}
    >
      {/* Left: Summary text */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span>
          Menampilkan halaman{' '}
          <strong className="text-slate-900 font-semibold">{currentPage.toLocaleString('id-ID')}</strong>{' '}
          dari{' '}
          <strong className="text-slate-900 font-semibold">{totalPages.toLocaleString('id-ID')}</strong>
        </span>
        {totalItems !== undefined && (
          <span className="text-slate-500 font-mono text-xs">
            (Total {totalItems.toLocaleString('id-ID')} {itemLabel})
          </span>
        )}
      </div>

      {/* Right: Controls & Direct Jump */}
      <div className="flex items-center flex-wrap gap-2">
        {/* Jump-to-page input */}
        <form onSubmit={handleJumpSubmit} className="flex items-center gap-1.5 mr-1">
          <span className="text-slate-500 whitespace-nowrap text-xs">Ke hal:</span>
          <input
            type="number"
            min={1}
            max={totalPages}
            value={jumpPage}
            onChange={(e) => setJumpPage(e.target.value)}
            disabled={disabled || totalPages <= 1}
            className="w-16 px-2 py-1 text-center font-mono text-xs font-semibold bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-teal-700 focus:border-teal-700 transition-all text-slate-900"
            placeholder="1"
          />
          <button
            type="submit"
            disabled={disabled || totalPages <= 1}
            className="px-2.5 py-1 text-xs font-medium text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Tuju
          </button>
        </form>

        {/* Navigation buttons */}
        <div className="flex items-center gap-1">
          {/* First page */}
          <button
            type="button"
            onClick={(e) => handlePageSelect(e, 1)}
            disabled={disabled || currentPage <= 1}
            title="Halaman Pertama"
            className="p-1.5 border border-slate-200 rounded-md hover:bg-slate-100/80 disabled:opacity-40 disabled:hover:bg-transparent text-slate-700 transition-colors cursor-pointer"
          >
            <ChevronsLeft className="w-3.5 h-3.5" />
          </button>

          {/* Previous page */}
          <button
            type="button"
            onClick={(e) => handlePageSelect(e, Math.max(1, currentPage - 1))}
            disabled={disabled || currentPage <= 1}
            className="px-2.5 py-1 border border-slate-200 rounded-md hover:bg-slate-100/80 disabled:opacity-40 disabled:hover:bg-transparent font-medium text-slate-700 text-xs inline-flex items-center gap-1 transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sebelumnya</span>
          </button>

          {/* Number buttons */}
          <div className="hidden md:flex items-center gap-1">
            {getVisiblePages().map((p, idx) =>
              p === '...' ? (
                <span key={`dots-${idx}`} className="px-1.5 text-slate-400 select-none">
                  ...
                </span>
              ) : (
                <button
                  key={`page-${p}`}
                  type="button"
                  onClick={(e) => handlePageSelect(e, Number(p))}
                  disabled={disabled}
                  className={`w-7 h-7 rounded-md text-xs font-semibold font-mono transition-colors cursor-pointer ${
                    currentPage === p
                      ? 'bg-teal-800 text-white shadow-2xs'
                      : 'text-slate-700 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  {p}
                </button>
              )
            )}
          </div>

          {/* Next page */}
          <button
            type="button"
            onClick={(e) => handlePageSelect(e, Math.min(totalPages, currentPage + 1))}
            disabled={disabled || currentPage >= totalPages}
            className="px-2.5 py-1 border border-slate-200 rounded-md hover:bg-slate-100/80 disabled:opacity-40 disabled:hover:bg-transparent font-medium text-slate-700 text-xs inline-flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span className="hidden sm:inline">Berikutnya</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          {/* Last page */}
          <button
            type="button"
            onClick={(e) => handlePageSelect(e, totalPages)}
            disabled={disabled || currentPage >= totalPages}
            title="Halaman Terakhir"
            className="p-1.5 border border-slate-200 rounded-md hover:bg-slate-100/80 disabled:opacity-40 disabled:hover:bg-transparent text-slate-700 transition-colors cursor-pointer"
          >
            <ChevronsRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
