'use client';

import { useState, useCallback } from 'react';
import { validateUploadFile } from '@/lib/uploadValidation';

interface DropzoneProps {
  onFile: (content: string, filename: string) => void;
  accept?: string[];
  maxSizeMB?: number;
}

export default function Dropzone({ onFile, accept = ['.csv', '.txt'], maxSizeMB = 5 }: DropzoneProps) {
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback((file: File) => {
    setError(null);

    const validation = validateUploadFile(file, { accept, maxSizeMB });
    if (!validation.ok) {
      setError(validation.error!);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      onFile(text, file.name);
    };
    reader.onerror = () => setError('Failed to read file');
    reader.readAsText(file);
  }, [accept, maxSizeMB, onFile]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, [handleFile]);

  return (
    <div
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
        dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
      }`}
    >
      <input
        type="file"
        accept={accept.join(',')}
        onChange={(e) => e.target.files && e.target.files[0] && handleFile(e.target.files[0])}
        className="hidden"
        id="dropzone-input"
      />
      <label htmlFor="dropzone-input" className="cursor-pointer">
        <p className="text-sm text-gray-600">Drop a file here or click to browse</p>
        <p className="text-xs text-gray-400 mt-1">CSV or TXT, max {maxSizeMB}MB, max 10,000 rows</p>
      </label>
      {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
    </div>
  );
}