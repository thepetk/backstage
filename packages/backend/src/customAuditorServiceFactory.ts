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
  coreServices,
  createServiceFactory,
} from '@backstage/backend-plugin-api';
import { WinstonRootAuditorService } from '@backstage/backend-defaults/auditor';
import * as winston from 'winston';

/*
 * NOTE: This is a test implementation to experiment with Winston transports and send audit logs
 * to different destinations. For this use case I'm just creating a file locally.
 * However, it could for sure be an external service like CloudWatch.
 */
export const customAuditorServiceFactory = createServiceFactory({
  service: coreServices.auditor,
  deps: {
    config: coreServices.rootConfig,
    auth: coreServices.auth,
    httpAuth: coreServices.httpAuth,
    plugin: coreServices.pluginMetadata,
  },
  createRootContext() {
    return WinstonRootAuditorService.create({
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple(),
          ),
        }),

        // file for all logs
        new winston.transports.File({
          filename: 'audit-logs.json',
          format: winston.format.json(),
          maxsize: 10 * 1024 * 1024,
          maxFiles: 10,
        }),

        // separate file for error logs
        new winston.transports.File({
          filename: 'audit-errors.json',
          level: 'error',
          format: winston.format.json(),
        }),
      ],
    });
  },
  factory({ config, plugin, auth, httpAuth }, root) {
    return root.forPlugin({ config, plugin, auth, httpAuth });
  },
});
