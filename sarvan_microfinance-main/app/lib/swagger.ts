import { companyNameShort, companyNameSmall } from '@/hooks/use-toast';
import { createSwaggerSpec } from 'next-swagger-doc';

export const getApiDocs = async () => {
    const spec = createSwaggerSpec({
        apiFolder: 'app/api',
        definition: {
            openapi: '3.0.0',
            info: {
                title: companyNameShort+' Microfinance API',
                version: '1.0.0',
                description: `
## Overview
${companyNameShort} Microfinance API provides endpoints for managing microfinance operations including user management, branch operations, center management, and loan processing.

## Authentication
All protected endpoints require a JWT Bearer token in the Authorization header:
\`\`\`
Authorization: Bearer <access_token>
\`\`\`

### Getting a Token
1. Call \`POST /api/auth/login\` with email and password
2. Use the returned \`accessToken\` for subsequent requests
3. Use \`POST /api/auth/refresh\` when the access token expires

## User Roles
- **ADMIN**: Full system access
- **BRANCH_MANAGER**: Manage their branch, centers, and FDOs
- **AREA_MANAGER**: Oversee multiple branches
- **FDO**: Field Development Officer - client/center operations
        `,
                contact: {
                    name: companyNameShort+' Microfinance Support',
                    email: 'support@'+companyNameSmall+'microfinance.com',
                },
            },
            servers: [
                {
                    url: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
                    description: 'API Server',
                },
            ],
            tags: [
                {
                    name: 'Authentication',
                    description: 'Login, logout, and token refresh endpoints',
                },
                {
                    name: 'Users',
                    description: 'User/Employee management operations',
                },
                {
                    name: 'Branches',
                    description: 'Branch management operations',
                },
                {
                    name: 'Centers',
                    description: 'Center management operations',
                },
                {
                    name: 'Center Transfer',
                    description: 'FDO transfer and assignment operations',
                },
            ],
            components: {
                securitySchemes: {
                    bearerAuth: {
                        type: 'http',
                        scheme: 'bearer',
                        bearerFormat: 'JWT',
                        description: 'JWT access token obtained from /api/auth/login',
                    },
                },
                schemas: {
                    ApiResponse: {
                        type: 'object',
                        properties: {
                            success: { type: 'boolean' },
                            data: { type: 'object' },
                            message: { type: 'string' },
                            error: { type: 'string' },
                        },
                    },
                    User: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            email: { type: 'string', format: 'email' },
                            firstName: { type: 'string' },
                            lastName: { type: 'string' },
                            role: {
                                type: 'string',
                                enum: ['ADMIN', 'BRANCH_MANAGER', 'FDO', 'AREA_MANAGER']
                            },
                            branchId: { type: 'string', nullable: true },
                            isActive: { type: 'boolean' },
                            createdAt: { type: 'string', format: 'date-time' },
                            updatedAt: { type: 'string', format: 'date-time' },
                            branch: { $ref: '#/components/schemas/BranchSummary' },
                        },
                    },
                    Branch: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                            code: { type: 'string' },
                            address: { type: 'string', nullable: true },
                            isActive: { type: 'boolean' },
                            createdAt: { type: 'string', format: 'date-time' },
                            updatedAt: { type: 'string', format: 'date-time' },
                        },
                    },
                    BranchSummary: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                            code: { type: 'string' },
                        },
                    },
                    Center: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                            code: { type: 'string' },
                            address: { type: 'string', nullable: true },
                            branchId: { type: 'string' },
                            status: {
                                type: 'string',
                                enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'],
                                description: 'Center approval status'
                            },
                            fdoId: { type: 'string', nullable: true },
                            createdById: { type: 'string', description: 'Branch Manager who created the center' },
                            approvedById: { type: 'string', nullable: true, description: 'Area Manager who approved/rejected the center' },
                            approvedAt: { type: 'string', format: 'date-time', nullable: true, description: 'Timestamp when center was approved/rejected' },
                            rejectionReason: { type: 'string', nullable: true, description: 'Reason for rejection if status is REJECTED' },
                            formationDate: { type: 'string', format: 'date-time', nullable: true },
                            nextMeetingDate: { type: 'string', format: 'date-time', nullable: true },
                            meetingDay: { type: 'string', nullable: true },
                            meetingTime: { type: 'string', nullable: true },
                            meetingPlace: { type: 'string', nullable: true },
                            mobileNumber: { type: 'string', nullable: true },
                            latitude: { type: 'number', nullable: true },
                            longitude: { type: 'number', nullable: true },
                            isActive: { type: 'boolean' },
                            createdAt: { type: 'string', format: 'date-time' },
                            updatedAt: { type: 'string', format: 'date-time' },
                            branch: { $ref: '#/components/schemas/BranchSummary' },
                            createdBy: { $ref: '#/components/schemas/User' },
                            approvedBy: { $ref: '#/components/schemas/User' },
                            fdo: { $ref: '#/components/schemas/User' },
                        },
                    },
                    AuthResponse: {
                        type: 'object',
                        properties: {
                            user: { $ref: '#/components/schemas/User' },
                            accessToken: { type: 'string' },
                            refreshToken: { type: 'string' },
                            branch: { $ref: '#/components/schemas/BranchSummary' },
                        },
                    },
                    Error: {
                        type: 'object',
                        properties: {
                            success: { type: 'boolean', example: false },
                            error: { type: 'string' },
                        },
                    },
                },
            },
            security: [{ bearerAuth: [] }],
        },
    });
    return spec;
};
