/**
 * Pure file-upload validation shared by the Dropzone component. Extracted so
 * the size/extension limits can be unit-tested without rendering React or
 * constructing real File objects (the vitest suite runs in a node environment).
 */
export interface UploadLimits {
  accept: string[];
  maxSizeMB: number;
}

export interface UploadValidationResult {
  ok: boolean;
  error?: string;
}

export function validateUploadFile(
  file: { name: string; size: number },
  limits: UploadLimits
): UploadValidationResult {
  const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
  if (!limits.accept.includes(ext)) {
    return { ok: false, error: `Invalid file type. Accepted: ${limits.accept.join(', ')}` };
  }

  if (file.size > limits.maxSizeMB * 1024 * 1024) {
    return { ok: false, error: `File too large. Max size: ${limits.maxSizeMB}MB` };
  }

  return { ok: true };
}
