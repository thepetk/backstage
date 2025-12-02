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
import {
  AuditorService,
  BackstageCredentials,
} from '@backstage/backend-plugin-api';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { JsonObject } from '@backstage/types';
import { ActionsService } from '@backstage/backend-plugin-api/alpha';
import { version } from '@backstage/plugin-mcp-actions-backend/package.json';
import { NotFoundError } from '@backstage/errors';

import { handleErrors } from './handleErrors';

export class McpService {
  private readonly actions: ActionsService;
  private readonly auditor: AuditorService;

  constructor(actions: ActionsService, auditor: AuditorService) {
    this.actions = actions;
    this.auditor = auditor;
  }

  static async create({
    actions,
    auditor,
  }: {
    actions: ActionsService;
    auditor: AuditorService;
  }) {
    return new McpService(actions, auditor);
  }

  getServer({ credentials }: { credentials: BackstageCredentials }) {
    const server = new McpServer(
      {
        name: 'backstage',
        // TODO: this version will most likely change in the future.
        version,
      },
      { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      // TODO: switch this to be configuration based later
      const { actions } = await this.actions.list({ credentials });

      // audit: mcp-tool-discovery
      await this.auditor.createEvent({
        eventId: 'mcp-tool-discovery',
        severityLevel: 'low',
        meta: {
          toolCount: actions.length,
          principal: (credentials.principal as any).userEntityRef,
        },
      });

      return {
        tools: actions.map(action => ({
          inputSchema: action.schema.input,
          // todo(blam): this is unfortunately not supported by most clients yet.
          // When this is provided you need to provide structuredContent instead.
          // outputSchema: action.schema.output,
          name: action.name,
          description: action.description,
          annotations: {
            title: action.title,
            destructiveHint: action.attributes.destructive,
            idempotentHint: action.attributes.idempotent,
            readOnlyHint: action.attributes.readOnly,
            openWorldHint: false,
          },
        })),
      };
    });

    server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      return handleErrors(async () => {
        const executionStart = Date.now();
        const inputSize = JSON.stringify(params.arguments || {}).length;

        // audit: mcp-tool-execution-request
        const executionEvent = await this.auditor.createEvent({
          eventId: 'mcp-tool-execution-request',
          severityLevel: 'medium',
          meta: {
            toolName: params.name,
            principal: (credentials.principal as any).userEntityRef,
            inputSize,
          },
        });

        try {
          const { actions } = await this.actions.list({ credentials });
          const action = actions.find(a => a.name === params.name);

          if (!action) {
            // audit: mcp-tool-not-found
            await this.auditor.createEvent({
              eventId: 'mcp-tool-not-found',
              severityLevel: 'medium',
              meta: {
                toolName: params.name,
                principal: (credentials.principal as any).userEntityRef,
              },
            });

            throw new NotFoundError(`Action "${params.name}" not found`);
          }

          const { output } = await this.actions.invoke({
            id: action.id,
            input: params.arguments as JsonObject,
            credentials,
          });

          const duration = Date.now() - executionStart;
          const outputSize = JSON.stringify(output).length;

          // audit: mcp-tool-execution-success
          executionEvent.success({
            meta: {
              duration,
              outputSize,
              principal: (credentials.principal as any).userEntityRef,
            },
          });

          return {
            // todo(blam): unfortunately structuredContent is not supported by most clients yet.
            // so the validation for the output happens in the default actions registry
            // and we return it as json text instead for now.
            content: [
              {
                type: 'text',
                text: ['```json', JSON.stringify(output, null, 2), '```'].join(
                  '\n',
                ),
              },
            ],
          };
        } catch (error) {
          const duration = Date.now() - executionStart;

          // audit: mcp-tool-execution-failure
          executionEvent.fail({
            error: error as Error,
            meta: {
              duration,
              errorType: error instanceof Error ? error.name : 'UnknownError',
              errorMessage:
                error instanceof Error ? error.message : String(error),
              principal: (credentials.principal as any).userEntityRef,
            },
          });

          throw error;
        }
      });
    });

    return server;
  }
}
