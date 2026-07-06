import { NextResponse } from 'next/server';

/**
 * OpenAPI 3 document for the public v1 API.
 *
 * Ghost-feature note (verification sprint 2026-07): the Swagger UI page at
 * /api/v1/docs shipped last session pointing at `/api/openapi`, but this route
 * did not exist — the docs page rendered a dead URL. This serves a static,
 * dependency-free OpenAPI 3.0.3 document covering all seven v1 resource groups
 * so try-it-out works. It is intentionally hand-authored (no spec-generation
 * framework / new deps) and public (Swagger UI must be able to fetch it).
 */

const bearerSecurity = [{ bearerAuth: [] }];

const ErrorResponse = {
  description: 'Error',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
    },
  },
};

const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'DealFlow AI v1 API',
    version: '1.0.0',
    description: 'Public REST API for DealFlow AI. All endpoints require a Bearer API key.',
  },
  servers: [{ url: '/', description: 'Current host' }],
  tags: [
    { name: 'auth', description: 'API key validation' },
    { name: 'contacts', description: 'Leads / contacts' },
    { name: 'campaigns', description: 'Outreach campaigns' },
    { name: 'conversations', description: 'Conversation history' },
    { name: 'approvals', description: 'Human approvals' },
    { name: 'analytics', description: 'Reporting metrics' },
    { name: 'webhooks', description: 'Webhook subscriptions' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Provide your API key as `Authorization: Bearer df_test_...`',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
        required: ['error'],
      },
      Contact: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          phone: { type: 'string' },
          email: { type: 'string', nullable: true },
          status: { type: 'string' },
          source: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      ContactCreate: {
        type: 'object',
        required: ['name', 'phone'],
        properties: {
          name: { type: 'string' },
          phone: { type: 'string' },
          email: { type: 'string' },
          type: { type: 'string', enum: ['seller', 'buyer'] },
          metadata: { type: 'object', additionalProperties: true },
        },
      },
    },
  },
  security: bearerSecurity,
  paths: {
    '/api/v1/auth': {
      post: {
        tags: ['auth'],
        summary: 'Validate an API key',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['key'],
                properties: { key: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Key is valid',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    valid: { type: 'boolean' },
                    organizationId: { type: 'string' },
                    scopes: { type: 'array', items: { type: 'string' } },
                    rateLimitPerMin: { type: 'integer' },
                  },
                },
              },
            },
          },
          401: ErrorResponse,
        },
      },
    },
    '/api/v1/contacts': {
      get: {
        tags: ['contacts'],
        summary: 'List contacts',
        security: bearerSecurity,
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100, default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          200: {
            description: 'A page of contacts',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/Contact' } },
                    limit: { type: 'integer' },
                    offset: { type: 'integer' },
                  },
                },
              },
            },
          },
          401: ErrorResponse,
        },
      },
      post: {
        tags: ['contacts'],
        summary: 'Create a contact',
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ContactCreate' } },
          },
        },
        responses: {
          201: {
            description: 'Created contact',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Contact' } },
            },
          },
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    '/api/v1/campaigns': {
      get: {
        tags: ['campaigns'],
        summary: 'List campaigns',
        security: bearerSecurity,
        responses: { 200: { description: 'Campaigns' }, 401: ErrorResponse },
      },
      post: {
        tags: ['campaigns'],
        summary: 'Create a campaign',
        security: bearerSecurity,
        responses: { 201: { description: 'Created campaign' }, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    '/api/v1/conversations': {
      get: {
        tags: ['conversations'],
        summary: 'List conversations',
        security: bearerSecurity,
        responses: { 200: { description: 'Conversations' }, 401: ErrorResponse },
      },
    },
    '/api/v1/approvals': {
      get: {
        tags: ['approvals'],
        summary: 'List pending approvals',
        security: bearerSecurity,
        responses: { 200: { description: 'Approvals' }, 401: ErrorResponse },
      },
      post: {
        tags: ['approvals'],
        summary: 'Resolve an approval',
        security: bearerSecurity,
        responses: { 200: { description: 'Approval resolved' }, 401: ErrorResponse },
      },
    },
    '/api/v1/analytics': {
      get: {
        tags: ['analytics'],
        summary: 'Reporting metrics',
        security: bearerSecurity,
        responses: { 200: { description: 'Metrics' }, 401: ErrorResponse },
      },
    },
    '/api/v1/webhooks': {
      get: {
        tags: ['webhooks'],
        summary: 'List webhook subscriptions',
        security: bearerSecurity,
        responses: { 200: { description: 'Webhooks' }, 401: ErrorResponse },
      },
      post: {
        tags: ['webhooks'],
        summary: 'Create a webhook subscription',
        security: bearerSecurity,
        responses: { 201: { description: 'Created webhook' }, 401: ErrorResponse },
      },
    },
  },
} as const;

export async function GET() {
  return NextResponse.json(openApiDocument);
}
