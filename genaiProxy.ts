/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export * from '@google/genai';

async function postJson(endpoint: string, body: any) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({error: res.statusText}));
    throw new Error(
      err.error || `Request to ${endpoint} failed with status ${res.status}`,
    );
  }
  return res.json();
}

async function* postStream(endpoint: string, body: any) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({error: res.statusText}));
    throw new Error(
      err.error ||
        `Stream request to ${endpoint} failed with status ${res.status}`,
    );
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const {value, done} = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, {stream: true});
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line);
      if (parsed.error) throw new Error(parsed.error);
      yield parsed;
    }
  }
  if (buffer.trim()) {
    const parsed = JSON.parse(buffer);
    if (parsed.error) throw new Error(parsed.error);
    yield parsed;
  }
}

class ProxiedChat {
  private model: string;
  private config: any;
  private history: any[];

  constructor(params: {model: string; config?: any; history?: any[]}) {
    this.model = params.model;
    this.config = params.config;
    this.history = params.history ? [...params.history] : [];
  }

  async sendMessage(params: any) {
    const message =
      typeof params === 'object' && params !== null && 'message' in params
        ? params.message
        : params;
    const mergedConfig =
      typeof params === 'object' && params !== null && 'config' in params
        ? {...this.config, ...params.config}
        : this.config;
    const result = await postJson('/api/chat', {
      model: this.model,
      config: mergedConfig,
      history: this.history,
      message,
    });
    if (result.history) {
      this.history = result.history;
    }
    return result;
  }

  async sendMessageStream(params: any) {
    const message =
      typeof params === 'object' && params !== null && 'message' in params
        ? params.message
        : params;
    const mergedConfig =
      typeof params === 'object' && params !== null && 'config' in params
        ? {...this.config, ...params.config}
        : this.config;
    const self = this;
    const userParts = Array.isArray(message)
      ? message.map((m) => (typeof m === 'string' ? {text: m} : m))
      : [{text: String(message)}];
    self.history.push({role: 'user', parts: userParts});

    async function* streamGenerator() {
      let fullText = '';
      for await (const chunk of postStream('/api/chat-stream', {
        model: self.model,
        config: mergedConfig,
        history: self.history.slice(0, -1),
        message,
      })) {
        fullText += chunk.text || '';
        yield chunk;
      }
      self.history.push({role: 'model', parts: [{text: fullText}]});
    }
    return streamGenerator();
  }

  async getHistory() {
    return this.history;
  }
}

export class GoogleGenAI {
  constructor(_options?: any) {}

  models = {
    generateContent: (params: any) => postJson('/api/generate-content', params),
    generateContentStream: (params: any) =>
      Promise.resolve(postStream('/api/generate-content-stream', params)),
    generateImages: (params: any) => postJson('/api/generate-images', params),
    generateVideos: (params: any) => postJson('/api/generate-videos', params),
  };

  operations = {
    getVideosOperation: (params: any) => {
      const op = params?.operation || params;
      return postJson('/api/videos-operation', {name: op?.name, operation: op});
    },
    get: (params: any) => {
      const op = params?.operation || params;
      return Promise.resolve({...op, done: true});
    },
  };

  fileSearchStores = {
    create: (params: any) => postJson('/api/rag-create', params),
    uploadToFileSearchStore: async (params: any) => {
      const file: File | Blob = params.file;
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Data = btoa(binary);
      return postJson('/api/rag-upload', {
        fileSearchStoreName: params.fileSearchStoreName,
        fileName: (file as File).name || 'document.pdf',
        mimeType: file.type || 'application/pdf',
        base64Data,
      });
    },
    delete: (params: any) => postJson('/api/rag-delete', params),
  };

  chats = {
    create: (params: any) => new ProxiedChat(params),
  };
}
