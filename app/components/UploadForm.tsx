'use client';

import { useRef, useState } from 'react';

export default function UploadForm({ token }: { token: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [purpose, setPurpose] = useState<string>('parse');
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) setFile(selectedFile);
  };

  const handleClear = () => {
    setFile(null);
    setPurpose('parse');
    setSuccess(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileCreate = async () => {
    if (!file) return;
    setSuccess(null);
    setError(null);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const base = `${process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}/api/upload/${token}`;
      const url = new URL(base);
      url.searchParams.set('purpose', purpose);

      const res = await fetch(url.toString(), {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        setError(await res.text());
        return;
      }

      const data = await res.json();
      if ('file_id' in data) {
        setSuccess(`File uploaded successfully! File ID: ${data.file_id}`);
      } else {
        setError('There was an error while uploading the file :(');
      }
    } catch (err) {
      setError('An error occurred while uploading the file :(');
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="upload-page">
      <div className="upload-container">
        <h1 className="upload-title">File Upload</h1>
        <>
          <div className="upload-field">
            <label htmlFor="purpose" className="upload-label">
              Upload purpose (optional)
            </label>
            <select
              id="purpose"
              value={purpose}
              className="upload-select"
              onChange={(e) => setPurpose(e.target.value)}
            >
              <option value="parse">parse</option>
              <option value="user_data">user_data</option>
              <option value="classify">classify</option>
              <option value="split">split</option>
              <option value="extract">extract</option>
              <option value="sheet">sheet</option>
              <option value="agent_app">agent_app</option>
            </select>
          </div>

          <div className="upload-field">
            <label htmlFor="file" className="upload-label">
              File
            </label>
            <input
              id="file"
              type="file"
              required
              ref={fileInputRef}
              className="upload-file-input"
              onChange={handleFileChange}
            />
          </div>

          <div className="upload-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!file || loading}
              onClick={handleFileCreate}
            >
              {file ? 'Upload' : 'Select a file and provide a token'}
            </button>

            <button
              type="button"
              className="btn btn-danger"
              onClick={handleClear}
            >
              Clear
            </button>
          </div>

          {loading && (
            <p className="upload-status upload-status-loading">
              Uploading your file...
            </p>
          )}
          {!loading && success && (
            <p className="upload-status upload-status-success">{success}</p>
          )}
          {!loading && error && (
            <p className="upload-status upload-status-error">{error}</p>
          )}
        </>
      </div>
    </div>
  );
}
