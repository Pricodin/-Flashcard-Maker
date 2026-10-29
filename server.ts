/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI} from '@google/genai';
import express from 'express';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!key) {
    throw new Error(
      'GEMINI_API_KEY or API_KEY environment variable is required on the server.',
    );
  }
  return key;
}

const MODEL_UPGRADES: Record<string, string> = {
  'gemini-2.5-flash': 'gemini-3-flash-preview',
  'gemini-2.5-pro': 'gemini-3.1-pro-preview',
  'gemini-2.5-pro-exp-03-25': 'gemini-3.1-pro-preview',
  'gemini-3-pro-preview': 'gemini-3.1-pro-preview',
  'gemini-2.0-flash': 'gemini-3-flash-preview',
  'gemini-2.0-flash-exp': 'gemini-3-flash-preview',
  'gemini-2.0-flash-preview-image-generation': 'gemini-2.5-flash-image',
};

function resolveModel(model?: string): string {
  if (!model) return 'gemini-3-flash-preview';
  return MODEL_UPGRADES[model] || model;
}

function getAI(): GoogleGenAI {
  return new GoogleGenAI({apiKey: getApiKey()});
}

function serializeResponse(response: any) {
  return {
    text: response?.text ?? '',
    candidates: response?.candidates ?? [],
    functionCalls: response?.functionCalls ?? undefined,
    groundingMetadata:
      response?.candidates?.[0]?.groundingMetadata ?? undefined,
    usageMetadata: response?.usageMetadata ?? undefined,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({limit: '50mb'}));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      hasKey: Boolean(process.env.GEMINI_API_KEY || process.env.API_KEY),
    });
  });

  app.get('/api/models', async (_req, res) => {
    try {
      const apiKey = getApiKey();
      const upstream = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
        {
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
        },
      );
      if (!upstream.ok) {
        return res.status(upstream.status).json({error: upstream.statusText});
      }
      const data = await upstream.json();
      res.json(data);
    } catch (error: any) {
      console.error('Error in /api/models:', error);
      res.status(500).json({error: error.message || String(error)});
    }
  });

  app.post('/api/generate-content', async (req, res) => {
    try {
      const ai = getAI();
      const {model: rawModel, contents, config} = req.body;
      const response = await ai.models.generateContent({
        model: resolveModel(rawModel),
        contents,
        config,
      });
      res.json(serializeResponse(response));
    } catch (error: any) {
      console.error('Error in /api/generate-content:', error);
      res
        .status(error?.status || 500)
        .json({error: error.message || String(error)});
    }
  });

  app.post('/api/generate-content-stream', async (req, res) => {
    try {
      const ai = getAI();
      const {model: rawModel, contents, config} = req.body;
      const responseStream = await ai.models.generateContentStream({
        model: resolveModel(rawModel),
        contents,
        config,
      });

      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('Cache-Control', 'no-cache');

      for await (const chunk of responseStream) {
        res.write(JSON.stringify(serializeResponse(chunk)) + '\n');
      }
      res.end();
    } catch (error: any) {
      console.error('Error in /api/generate-content-stream:', error);
      if (!res.headersSent) {
        res
          .status(error?.status || 500)
          .json({error: error.message || String(error)});
      } else {
        res.write(
          JSON.stringify({error: error.message || String(error)}) + '\n',
        );
        res.end();
      }
    }
  });

  app.post('/api/generate-images', async (req, res) => {
    try {
      const ai = getAI();
      const {model, prompt, config} = req.body;
      const response = await ai.models.generateImages({
        model: resolveModel(model),
        prompt,
        config,
      });
      res.json(response);
    } catch (error: any) {
      console.error('Error in /api/generate-images:', error);
      res
        .status(error?.status || 500)
        .json({error: error.message || String(error)});
    }
  });

  app.post('/api/generate-videos', async (req, res) => {
    try {
      const ai = getAI();
      const {model, prompt, image, video, config} = req.body;
      const operation = await ai.models.generateVideos({
        model,
        prompt,
        image,
        video,
        config,
      });
      res.json({
        name: operation.name,
        done: operation.done,
        error: operation.error,
        response: operation.response,
        metadata: operation.metadata,
      });
    } catch (error: any) {
      console.error('Error in /api/generate-videos:', error);
      res
        .status(error?.status || 500)
        .json({error: error.message || String(error)});
    }
  });

  app.post('/api/videos-operation', async (req, res) => {
    try {
      const ai = getAI();
      const {name, operation: opInput} = req.body;
      const operation = await ai.operations.getVideosOperation({
        operation: opInput || ({name} as any),
      });
      const serialized: any = {
        name: operation.name,
        done: operation.done,
        error: operation.error,
        metadata: operation.metadata,
        response: operation.response
          ? JSON.parse(JSON.stringify(operation.response))
          : undefined,
      };
      if (serialized.response?.generatedVideos) {
        for (const v of serialized.response.generatedVideos) {
          if (v?.video?.uri && !v.video.uri.startsWith('/api/')) {
            const b64 = Buffer.from(v.video.uri, 'utf-8').toString('base64');
            v.video.uri = `/api/video-download?b64=${encodeURIComponent(b64)}`;
          }
        }
      }
      res.json(serialized);
    } catch (error: any) {
      console.error('Error in /api/videos-operation:', error);
      res
        .status(error?.status || 500)
        .json({error: error.message || String(error)});
    }
  });

  app.get('/api/video-download', async (req, res) => {
    try {
      const b64 = String(req.query.b64 || '');
      const rawUri = b64
        ? Buffer.from(b64, 'base64').toString('utf-8')
        : String(req.query.uri || '');
      if (!rawUri || !rawUri.startsWith('https://')) {
        return res.status(400).json({error: 'Invalid video URI'});
      }
      const cleanUri = rawUri.replace(/([?&])key=[^&]*/g, '');
      const apiKey = getApiKey();
      const upstream = await fetch(cleanUri, {
        headers: {'x-goog-api-key': apiKey},
      });
      if (!upstream.ok) {
        return res.status(upstream.status).send(await upstream.text());
      }
      res.setHeader(
        'Content-Type',
        upstream.headers.get('content-type') || 'video/mp4',
      );
      const arrayBuffer = await upstream.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
    } catch (error: any) {
      console.error('Error in /api/video-download:', error);
      res.status(500).json({error: error.message || String(error)});
    }
  });

  app.post('/api/rag-create', async (req, res) => {
    try {
      const ai = getAI();
      const ragStore = await ai.fileSearchStores.create(req.body);
      res.json(ragStore);
    } catch (error: any) {
      console.error('Error in /api/rag-create:', error);
      res
        .status(error?.status || 500)
        .json({error: error.message || String(error)});
    }
  });

  app.post('/api/rag-upload', async (req, res) => {
    const {fileSearchStoreName, fileName, mimeType, base64Data} = req.body;
    const safeName = String(fileName || 'document.pdf').replace(
      /[^a-zA-Z0-9._-]/g,
      '_',
    );
    const tmpPath = path.join('/tmp', `${Date.now()}-${safeName}`);
    try {
      const ai = getAI();
      fs.writeFileSync(tmpPath, Buffer.from(base64Data, 'base64'));
      let op = await ai.fileSearchStores.uploadToFileSearchStore({
        fileSearchStoreName,
        file: tmpPath,
        config: mimeType ? {mimeType} : undefined,
      } as any);
      while (!op.done) {
        await new Promise((r) => setTimeout(r, 2000));
        op = await ai.operations.get({operation: op});
      }
      res.json({done: true, name: op.name, response: op.response});
    } catch (error: any) {
      console.error('Error in /api/rag-upload:', error);
      res
        .status(error?.status || 500)
        .json({error: error.message || String(error)});
    } finally {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {}
    }
  });

  app.post('/api/rag-delete', async (req, res) => {
    try {
      const ai = getAI();
      const result = await ai.fileSearchStores.delete(req.body);
      res.json(result ?? {});
    } catch (error: any) {
      console.error('Error in /api/rag-delete:', error);
      res
        .status(error?.status || 500)
        .json({error: error.message || String(error)});
    }
  });

  app.post('/api/chat', async (req, res) => {
    try {
      const ai = getAI();
      const {model: rawModel, config, history, message} = req.body;
      const chat = ai.chats.create({
        model: resolveModel(rawModel),
        config,
        history: history || [],
      });
      const msgPayload =
        typeof message === 'object' && message !== null && 'message' in message
          ? message.message
          : message;
      const response = await chat.sendMessage({message: msgPayload});
      res.json({
        ...serializeResponse(response),
        history: await chat.getHistory(),
      });
    } catch (error: any) {
      console.error('Error in /api/chat:', error);
      res
        .status(error?.status || 500)
        .json({error: error.message || String(error)});
    }
  });

  app.post('/api/chat-stream', async (req, res) => {
    try {
      const ai = getAI();
      const {model: rawModel, config, history, message} = req.body;
      const chat = ai.chats.create({
        model: resolveModel(rawModel),
        config,
        history: history || [],
      });
      const msgPayload =
        typeof message === 'object' && message !== null && 'message' in message
          ? message.message
          : message;
      const responseStream = await chat.sendMessageStream({
        message: msgPayload,
      });

      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('Cache-Control', 'no-cache');

      for await (const chunk of responseStream) {
        res.write(JSON.stringify(serializeResponse(chunk)) + '\n');
      }
      res.end();
    } catch (error: any) {
      console.error('Error in /api/chat-stream:', error);
      if (!res.headersSent) {
        res
          .status(error?.status || 500)
          .json({error: error.message || String(error)});
      } else {
        res.write(
          JSON.stringify({error: error.message || String(error)}) + '\n',
        );
        res.end();
      }
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
