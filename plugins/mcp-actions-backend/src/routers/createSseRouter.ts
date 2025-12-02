/*
 * Copyright 2025 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import PromiseRouter from 'express-promise-router';
import { Router } from 'express';
import { McpService } from '../services/McpService';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  AuditorService,
  BackstageCredentials,
  HttpAuthService,
} from '@backstage/backend-plugin-api';
import { auditCreateEvent } from '../services/auditorUtils';

/**
 * Legacy SSE endpoint for older clients, hopefully will not be needed for much longer.
 */
export const createSseRouter = ({
  mcpService,
  httpAuth,
  auditor,
}: {
  mcpService: McpService;
  httpAuth: HttpAuthService;
  auditor: AuditorService;
}): Router => {
  const router = PromiseRouter();
  const transportsToSessionId = new Map<string, SSEServerTransport>();

  router.get('/', async (req, res) => {
    const connectionStart = Date.now();
    let credentials: BackstageCredentials | undefined;

    try {
      // audit: mcp-auth-attempt
      const authAttemptEvent = await auditCreateEvent(
        auditor,
        'auth-attempt',
        req,
        'medium',
        {
          transport: 'sse',
          hasAuthHeader: !!req.headers.authorization,
        },
      );

      credentials = await httpAuth.credentials(req);

      // audit: mcp-auth-success
      authAttemptEvent.success({
        meta: {
          principal: (credentials.principal as any).userEntityRef,
        },
      });

      const server = mcpService.getServer({
        credentials,
      });

      const transport = new SSEServerTransport(
        `${req.originalUrl}/messages`,
        res,
      );

      transportsToSessionId.set(transport.sessionId, transport);

      // audit: mcp-connection-established
      const connectionEvent = await auditCreateEvent(
        auditor,
        'connection-established',
        req,
        'medium',
        {
          transport: 'sse',
          sessionId: transport.sessionId,
          principal: (credentials.principal as any).userEntityRef,
        },
      );

      res.on('close', () => {
        const duration = Date.now() - connectionStart;

        // audit: mcp-connection-closed
        auditCreateEvent(auditor, 'connection-closed', req, 'low', {
          transport: 'sse',
          sessionId: transport.sessionId,
          duration,
          principal: (credentials?.principal as any)?.userEntityRef,
        });

        transportsToSessionId.delete(transport.sessionId);
      });

      await server.connect(transport);

      connectionEvent.success();
    } catch (error) {
      // audit: mcp-connection-error
      await auditCreateEvent(auditor, 'connection-error', req, 'high', {
        transport: 'sse',
        errorType: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: error instanceof Error ? error.message : String(error),
        principal: (credentials?.principal as any)?.userEntityRef,
      });
      throw error;
    }
  });

  router.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId as string;

    if (!sessionId) {
      // audit: mcp-invalid-session
      await auditCreateEvent(auditor, 'invalid-session', req, 'medium', {
        error: 'sessionId is required',
        statusCode: 400,
      });

      res.status(400).contentType('text/plain').write('sessionId is required');
      return;
    }

    const transport = transportsToSessionId.get(sessionId);
    if (transport) {
      await transport.handlePostMessage(req, res, req.body);
    } else {
      // audit: mcp-invalid-session
      await auditCreateEvent(auditor, 'invalid-session', req, 'medium', {
        sessionId,
        error: 'No transport found for sessionId',
        statusCode: 400,
      });

      res
        .status(400)
        .contentType('text/plain')
        .write(`No transport found for sessionId "${sessionId}"`);
    }
  });
  return router;
};
