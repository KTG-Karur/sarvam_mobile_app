import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import {
  handleCorsPreflight,
  errorResponse,
  successResponse,
  withAuth,
  withRole,
} from '@/app/lib/api-utils';

/**
 * Update branch product mapping schema
 */
const updateProductMappingSchema = z.object({
  branchId: z.string().min(1, 'Branch ID is required'),
  productMappings: z.array(
    z.object({
      productId: z.string().min(1, 'Product ID is required'),
      productName: z.string().min(1, 'Product name is required'),
      frequency: z.string().optional(),
      loanAmount: z.number().optional(),
      totalDues: z.number().optional(),
      interest: z.number().optional(),
      isAccessible: z.boolean(),
    })
  ),
});

/**
 * @swagger
 * /api/branches/product-mapping:
 *   get:
 *     tags:
 *       - Branches
 *     summary: Get Product Mappings for Branch
 *     description: Fetch all product mappings for a specific branch
 *     parameters:
 *       - in: query
 *         name: branchId
 *         required: true
 *         schema:
 *           type: string
 *         description: Branch ID
 *     responses:
 *       200:
 *         description: Product mappings fetched successfully
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Authentication required
 *   post:
 *     tags:
 *       - Branches
 *     summary: Update Branch Product Mappings
 *     description: Update product accessibility mappings for a branch. **Admin only.**
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - branchId
 *               - productMappings
 *             properties:
 *               branchId:
 *                 type: string
 *               productMappings:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     productId:
 *                       type: string
 *                     productName:
 *                       type: string
 *                     frequency:
 *                       type: string
 *                     loanAmount:
 *                       type: number
 *                     totalDues:
 *                       type: number
 *                     interest:
 *                       type: number
 *                     isAccessible:
 *                       type: boolean
 *     responses:
 *       200:
 *         description: Product mappings updated successfully
 *       400:
 *         description: Invalid request data
 *       403:
 *         description: Admin access required
 */

/**
 * OPTIONS /api/branches/product-mapping
 */
export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * GET /api/branches/product-mapping
 * Fetch product mappings for a branch
 */
export async function GET(request: NextRequest) {
  return withAuth(async (req) => {
    try {
      const { searchParams } = new URL(req.url);
      const branchId = searchParams.get('branchId');

      if (!branchId) {
        return errorResponse('Branch ID is required', 400);
      }

      // Verify branch exists
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
      });

      if (!branch) {
        return errorResponse('Branch not found', 404);
      }

      // Fetch all product mappings for this branch
      const mappings = await prisma.branchProductMapping.findMany({
        where: { branchId },
        orderBy: { productName: 'asc' },
      });

      return successResponse(mappings, 'Product mappings fetched successfully');
    } catch (error) {
      console.error('Error fetching product mappings:', error);
      return errorResponse('Failed to fetch product mappings', 500);
    }
  })(request);
}

/**
 * POST /api/branches/product-mapping
 * Update product mappings for a branch (Admin only)
 */
export async function POST(request: NextRequest) {
  return withRole(['ADMIN'], async (req) => {
    try {
      const body = await req.json();

      // Validate request body
      const validationResult = updateProductMappingSchema.safeParse(body);
      if (!validationResult.success) {
        return errorResponse(
          validationResult.error.errors[0]?.message || 'Invalid request data',
          400
        );
      }

      const { branchId, productMappings } = validationResult.data;

      // Verify branch exists
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
      });

      if (!branch) {
        return errorResponse('Branch not found', 404);
      }

      // Use transaction to ensure atomicity
      await prisma.$transaction(async (tx) => {
        // Delete existing mappings for this branch
        await tx.branchProductMapping.deleteMany({
          where: { branchId },
        });

        // Create new mappings
        if (productMappings.length > 0) {
          await tx.branchProductMapping.createMany({
            data: productMappings.map((mapping) => ({
              branchId,
              productId: mapping.productId,
              productName: mapping.productName,
              frequency: mapping.frequency || null,
              loanAmount: mapping.loanAmount ? mapping.loanAmount : null,
              totalDues: mapping.totalDues || null,
              interest: mapping.interest ? mapping.interest : null,
              isAccessible: mapping.isAccessible,
            })),
          });
        }
      });

      // Fetch updated mappings
      const updatedMappings = await prisma.branchProductMapping.findMany({
        where: { branchId },
        orderBy: { productName: 'asc' },
      });

      return successResponse(
        updatedMappings,
        'Product mappings updated successfully'
      );
    } catch (error) {
      console.error('Error updating product mappings:', error);
      return errorResponse('Failed to update product mappings', 500);
    }
  })(request);
}

