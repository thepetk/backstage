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

import type {
  AuditorService,
  AuditorServiceEvent,
} from '@backstage/backend-plugin-api';
import { JsonObject } from '@backstage/types';
import express from 'express';
import kebabCase from 'just-kebab-case';

const UNKNOWN_MCP_EVENT = 'mcp-unknown-event';
export type McpAuditSeverityLevel = 'low' | 'medium' | 'high' | 'critical';

// Creates an audit event for MCP operations following Backstage naming conventions
export async function auditCreateEvent(
  auditor: AuditorService,
  eventId: string | undefined,
  req: express.Request,
  severityLevel: McpAuditSeverityLevel = 'medium',
  meta?: JsonObject,
): Promise<AuditorServiceEvent> {
  let normalizedEventId = eventId ? kebabCase(eventId) : UNKNOWN_MCP_EVENT;
  if (!normalizedEventId.startsWith('mcp-')) {
    normalizedEventId = `mcp-${normalizedEventId}`;
  }

  return await auditor.createEvent({
    eventId: normalizedEventId,
    severityLevel,
    request: req,
    meta,
  });
}
