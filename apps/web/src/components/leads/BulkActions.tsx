'use client';

import {
  TagIcon,
  UserPlusIcon,
  TrashIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';

interface BulkActionsProps {
  selectedCount: number;
  onAssign: () => void;
  onTag: () => void;
  onExport: () => void;
  onDelete: () => void;
  onClearSelection: () => void;
}

export function BulkActions({
  selectedCount,
  onAssign,
  onTag,
  onExport,
  onDelete,
  onClearSelection,
}: BulkActionsProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-2 px-4 py-3 bg-gray-900 text-white rounded-lg shadow-lg">
        <span className="text-sm font-medium mr-2">
          {selectedCount} selected
        </span>
        <div className="h-4 w-px bg-gray-700" />
        <button
          onClick={onAssign}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm hover:bg-gray-800 rounded"
        >
          <UserPlusIcon className="h-4 w-4" />
          Assign
        </button>
        <button
          onClick={onTag}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm hover:bg-gray-800 rounded"
        >
          <TagIcon className="h-4 w-4" />
          Tag
        </button>
        <button
          onClick={onExport}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm hover:bg-gray-800 rounded"
        >
          <ArrowDownTrayIcon className="h-4 w-4" />
          Export
        </button>
        <div className="h-4 w-px bg-gray-700" />
        <button
          onClick={onDelete}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-400 hover:bg-gray-800 rounded"
        >
          <TrashIcon className="h-4 w-4" />
          Delete
        </button>
        <button
          onClick={onClearSelection}
          className="ml-2 text-sm text-gray-400 hover:text-white"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
