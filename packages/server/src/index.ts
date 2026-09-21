import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { filesRouter } from './routes/files';
import { createAgentRouter } from './routes/agent';
import { createMcpRouter } from './routes/mcp';
import { createConfigRouter } from './routes/config';
import { createWorkspaceRouter } from './routes/workspace';
import { createLLMRouter } from './routes/llm';
import { createGitRouter } from './routes/git';
import { WorkspaceManager } from './workspace/manager';
import { LLMGateway, createLogger, LOG_CATEGORY } from '@openwork/agent';
import { requestLoggerMiddleware } from './middleware/requestLogger';
import { authMiddleware } from './middleware/auth';
import { approvalBroker } from './approval-broker';

const log = createLogger(LOG_CATEGORY.HTTP);

export interface ServerConfig {
  port?: number;
  host?: string;
  corsOrigin?: string;
  serveStatic?: string;
  configDir?: string;
}

export function createApp(config: ServerConfig = {}) {
  const app = express();
  const port = config.port ?? 20385;
  const host = config.host ?? '0.0.0.0';
  const configDir = config.configDir || './config';

  const workspaceManager = new WorkspaceManager(configDir, approvalBroker.request);
  const llmGateway = new LLMGateway(configDir);

  app.use(cors({ origin: config.corsOrigin ?? '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
  app.use(express.json({ limit: '50mb' }));
  app.use(requestLoggerMiddleware);
  app.use('/api', authMiddleware);

  app.use('/api/files', filesRouter);
  app.use('/api/agent', createAgentRouter(configDir, workspaceManager, llmGateway));
  app.use('/api/mcp', createMcpRouter(configDir));
  app.use('/api/config', createConfigRouter(configDir));
  app.use('/api/workspace', createWorkspaceRouter(workspaceManager, llmGateway));
  app.use('/api/llm', createLLMRouter(llmGateway));
  app.use('/api/git', createGitRouter());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  if (config.serveStatic) {
    app.use(express.static(config.serveStatic));
    app.get('*', (_req, res) => {
      res.sendFile('index.html', { root: config.serveStatic });
    });
  }

  return { app, port, host };
}

export function startServer(config: ServerConfig = {}) {
  const { app, port, host } = createApp(config);
  const server = createServer(app);

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log.error(`Port ${port} is already in use`, { port, host, hint: 'Try setting SERVER_PORT env or changing app-config.json.' });
    } else {
      log.error(`Server error: ${err.message}`, { port, host, code: err.code });
    }
  });

  server.listen(port, host, () => {
    log.info(`OpenWork server running at http://${host}:${port}`, { port, host, configDir: config.configDir });
  });

  return server;
}
