import React, { useState, useRef } from 'react';
import { Upload, X, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../services/api';

export function UploadModal({ isOpen, onClose, onUploadSuccess }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const handleFileSelect = (selectedFile) => {
    setError(null);
    if (!selectedFile) return;

    const validExtensions = ['.pdf', '.docx', '.txt', '.md'];
    const fileName = selectedFile.name.toLowerCase();
    const isValid = validExtensions.some(ext => fileName.endsWith(ext));

    if (!isValid) {
      setError('Unsupported file type. Please select a PDF, DOCX, TXT, or MD document.');
      return;
    }

    if (selectedFile.size > 25 * 1024 * 1024) {
      setError('File size exceeds the 25 MB maximum limit.');
      return;
    }

    setFile(selectedFile);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const startUpload = async () => {
    if (!file) return;

    try {
      setUploading(true);
      setError(null);
      setProgress(5);
      setStatusText('Requesting pre-signed storage URL...');

      // 1. Request upload URL from CloudVault API
      const { uploadUrl, documentId } = await api.getUploadUrl({
        filename: file.name,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream'
      });

      // 2. Direct upload to Storage (S3 / Local)
      setStatusText('Streaming document payload to cloud storage...');
      await api.uploadFileToUrl(uploadUrl, file, (percent) => {
        setProgress(Math.max(10, Math.min(percent, 90)));
      });

      // 3. Notify backend that upload is complete to start ingestion
      setProgress(95);
      setStatusText('Initiating vector extraction & chunking pipeline...');
      await api.completeUpload(documentId, {
        fileSize: file.size,
        mimeType: file.type
      });

      setProgress(100);
      setStatusText('Document queued for ingestion!');

      // Callback to refresh dashboard documents
      setTimeout(() => {
        onUploadSuccess(documentId);
        onClose();
        // Reset state
        setFile(null);
        setUploading(false);
        setProgress(0);
        setStatusText('');
      }, 700);

    } catch (err) {
      console.error('Upload failed:', err);
      setError(err.message || 'File upload failed. Please try again.');
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-lg glass-panel rounded-2xl p-6 shadow-2xl border border-slate-700/80 bg-[#101524]">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div>
            <h3 className="text-lg font-semibold text-white">Upload New Document</h3>
            <p className="text-xs text-slate-400">Direct-to-S3 pre-signed upload with vector indexing</p>
          </div>
          <button
            onClick={onClose}
            disabled={uploading}
            className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Dropzone */}
        <div className="mt-5 space-y-4">
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !uploading && fileInputRef.current?.click()}
            className={`cursor-pointer border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 ${
              isDragOver
                ? 'border-sky-400 bg-sky-500/10'
                : 'border-slate-700 hover:border-slate-500 bg-slate-900/40 hover:bg-slate-900/80'
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => handleFileSelect(e.target.files?.[0])}
              className="hidden"
              accept=".pdf,.docx,.txt,.md"
              disabled={uploading}
            />

            <div className="flex flex-col items-center">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-sky-500/20 to-indigo-500/20 flex items-center justify-center text-sky-400 mb-3 border border-sky-500/30">
                <Upload className="w-7 h-7" />
              </div>
              <p className="text-sm font-medium text-slate-200">
                {file ? file.name : 'Click to select or drag and drop document'}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Supported formats: <span className="text-slate-400 font-semibold">PDF, DOCX, TXT, MD</span> (Max 25 MB)
              </p>
            </div>
          </div>

          {/* Selected File Details */}
          {file && !uploading && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-900/60 border border-slate-800">
              <div className="flex items-center space-x-3 truncate">
                <FileText className="w-5 h-5 text-sky-400 shrink-0" />
                <div className="truncate">
                  <p className="text-xs font-medium text-slate-200 truncate">{file.name}</p>
                  <p className="text-[11px] text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                }}
                className="text-slate-400 hover:text-rose-400 text-xs px-2 py-1"
              >
                Clear
              </button>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="flex items-start space-x-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Progress Indicator */}
          {uploading && (
            <div className="space-y-2 p-3 rounded-lg bg-slate-900/80 border border-slate-800">
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span className="flex items-center space-x-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
                  <span>{statusText}</span>
                </span>
                <span className="font-semibold text-sky-400">{progress}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-all duration-300 rounded-full"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="mt-6 flex items-center justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={startUpload}
            disabled={!file || uploading}
            className="flex items-center space-x-2 px-5 py-2 text-xs font-medium rounded-lg bg-gradient-to-r from-sky-500 to-indigo-600 text-white shadow-lg shadow-sky-500/20 hover:from-sky-400 hover:to-indigo-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Processing...</span>
              </>
            ) : (
              <span>Upload Document</span>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
