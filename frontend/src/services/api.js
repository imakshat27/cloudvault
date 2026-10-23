const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:3000/api');

function getAuthHeader() {
  const token = localStorage.getItem('cloudvault_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeader(),
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMsg = data.error || `HTTP error ${response.status}`;
    const error = new Error(errorMsg);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export const api = {
  // Auth
  async register(email, password) {
    return request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  async login(email, password) {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  async getMe() {
    return request('/auth/me');
  },

  // Documents
  async listDocuments() {
    return request('/documents');
  },

  async getUploadUrl({ filename, fileSize, mimeType }) {
    return request('/documents/upload-url', {
      method: 'POST',
      body: JSON.stringify({ filename, fileSize, mimeType }),
    });
  },

  async completeUpload(documentId, { fileSize, mimeType } = {}) {
    return request(`/documents/${documentId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ fileSize, mimeType }),
    });
  },

  async getDocumentStatus(documentId) {
    return request(`/documents/${documentId}/status`);
  },

  async shareDocument(documentId, { email, permission = 'view' }) {
    return request(`/documents/${documentId}/share`, {
      method: 'POST',
      body: JSON.stringify({ email, permission }),
    });
  },

  async getDocumentShares(documentId) {
    return request(`/documents/${documentId}/shares`);
  },

  async deleteDocument(documentId) {
    return request(`/documents/${documentId}`, {
      method: 'DELETE',
    });
  },

  async reindexDocument(documentId) {
    return request(`/documents/${documentId}/reindex`, {
      method: 'POST',
    });
  },

  // Upload file to URL (handles both S3 pre-signed PUT and local endpoint)
  async uploadFileToUrl(uploadUrl, file, onProgress) {
    // If it's a relative URL (local dev upload endpoint)
    const targetUrl = uploadUrl.startsWith('http')
      ? uploadUrl
      : `${API_BASE.replace('/api', '')}${uploadUrl}`;

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', targetUrl);

      if (onProgress) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            onProgress(percent);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ status: xhr.status });
        } else {
          reject(new Error(`Upload failed with HTTP status ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during file upload'));
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.send(file);
    });
  },

  // Search & Ask
  async search(query, limit = 5) {
    return request('/search', {
      method: 'POST',
      body: JSON.stringify({ query, limit }),
    });
  },

  async ask(question, limit = 4) {
    return request('/ask', {
      method: 'POST',
      body: JSON.stringify({ question, limit }),
    });
  },

  async getHealth() {
    return request('/health');
  }
};
