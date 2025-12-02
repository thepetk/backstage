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
import { randomUUID } from 'node:crypto';
import { McpService } from '../services/McpService';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  AuditorService,
  BackstageCredentials,
  HttpAuthService,
  LoggerService,
} from '@backstage/backend-plugin-api';
import { isError } from '@backstage/errors';
import { auditCreateEvent } from '../services/auditorUtils';

export const createStreamableRouter = ({
  mcpService,
  httpAuth,
  logger,
  auditor,
}: {
  mcpService: McpService;
  logger: LoggerService;
  httpAuth: HttpAuthService;
  auditor: AuditorService;
}): Router => {
  const router = PromiseRouter();

  router.post('/', async (req, res) => {
    const connectionStart = Date.now();
    let credentials: BackstageCredentials | undefined;
    let clientId: string | undefined;

    try {
      // audit: mcp-auth-attempt
      const authAttemptEvent = await auditCreateEvent(
        auditor,
        'auth-attempt',
        req,
        'medium',
        {
          transport: 'streamable',
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

      clientId = randomUUID();
      const server = mcpService.getServer({
        credentials,
      });

      const transport = new StreamableHTTPServerTransport({
        // stateless implementation for now, so that we can support multiple
        // instances of the server backend, and avoid sticky sessions.
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);

      // audit: mcp-connection-established
      const connectionEvent = await auditCreateEvent(
        auditor,
        'connection-established',
        req,
        'medium',
        {
          transport: 'streamable',
          clientId,
          principal: (credentials.principal as any).userEntityRef,
        },
      );

      await transport.handleRequest(req, res, req.body);

      res.on('close', () => {
        const duration = Date.now() - connectionStart;

        // audit: mcp-connection-closed
        auditCreateEvent(auditor, 'connection-closed', req, 'low', {
          transport: 'streamable',
          clientId,
          duration,
          principal: (credentials?.principal as any)?.userEntityRef,
        });

        transport.close();
        server.close();
      });

      connectionEvent.success();
    } catch (error) {
      if (isError(error)) {
        logger.error(error.message);
      }

      // audit: mcp-http-error
      const errorEvent = await auditCreateEvent(
        auditor,
        'http-error',
        req,
        'high',
        {
          transport: 'streamable',
          clientId,
          errorType: isError(error) ? error.name : 'UnknownError',
          errorMessage: isError(error) ? error.message : String(error),
          statusCode: 500,
          jsonrpcCode: -32603,
          principal: (credentials?.principal as any)?.userEntityRef,
        },
      );

      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }

      errorEvent.fail({ error: error as Error });
    }
  });

  router.get('/', async (req, res) => {
    // audit: mcp-method-not-allowed
    await auditCreateEvent(auditor, 'method-not-allowed', req, 'low', {
      method: 'GET',
      statusCode: 405,
      jsonrpcCode: -32000,
    });

    res.writeHead(405).end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Method not allowed.',
        },
        id: null,
      }),
    );
  });

  router.delete('/', async (req, res) => {
    // audit: mcp-method-not-allowed
    await auditCreateEvent(auditor, 'method-not-allowed', req, 'low', {
      method: 'DELETE',
      statusCode: 405,
      jsonrpcCode: -32000,
    });

    res.writeHead(405).end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Method not allowed.',
        },
        id: null,
      }),
    );
  });

  return router;
};
