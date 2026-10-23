import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
  handleCorsPreflight,
  errorResponse,
  successResponse,
  withAuth,
  withRole,
} from '@/app/lib/api-utils';

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/products — List loan products (with optional branch-level filtering)
//
// Query params:
//   productId            — Fetch a single product by ID (for preview/edit)
//   includeTemplates — Include schedule templates in the response
//   branchId              — Filter to only products accessible for this branch
//                      (via BranchProductMapping). If omitted, returns the
//                      full master catalog (used by admin/product-map screens).
// ─────────────────────────────────────────────────────────────────────────────

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
  return withAuth(async () => {
    try {
      const { searchParams } = new URL(request.url);
      const includeTemplates = searchParams.get('includeTemplates') === 'true';
      const productId = searchParams.get('productId');
      const branchId = searchParams.get('branchId');

      // ── Single product fetch (for preview/edit) ──
      if (productId) {
        const product = await prisma.loanProduct.findUnique({
          where: { productId },
          include: {
            scheduleTemplates: {
              orderBy: { installmentNo: 'asc' },
            },
            loanProductType: true, // ADD THIS
          },
        });

        if (!product || !product.isActive) {
          return errorResponse('Product not found', 404);
        }

        return successResponse(transformProduct(product), 'Product fetched successfully');
      }

      // ── Branch-filtered product list ──
      // When branchId is provided, only return products that the admin has
      // explicitly marked as accessible for that branch in the Product Map.
      if (branchId) {
        const accessibleMappings = await prisma.branchProductMapping.findMany({
          where: {
            branchId,
            isAccessible: true,
          },
          select: { productId: true },
        });

        // Extract the productId strings (LoanProduct.productId, not the internal id)
        const accessibleProductIds = accessibleMappings.map((m) => m.productId);

        if (accessibleProductIds.length === 0) {
          // No products mapped for this branch — return empty list
          return successResponse([], 'No products are accessible for this branch');
        }

        const products = await prisma.loanProduct.findMany({
          where: {
            isActive: true,
            productId: { in: accessibleProductIds },
          },
          include: {
            scheduleTemplates: includeTemplates ? { orderBy: { installmentNo: 'asc' } } : undefined,
            loanProductType: true, // ADD THIS
          },
          orderBy: { createdAt: 'desc' },
        });

        const transformedProducts = products.map(transformProduct);
        return successResponse(transformedProducts, 'Products fetched successfully');
      }

      // ── Full master catalog (no branch filter) ──
      // Used by admin screens: Master > Loan Products, Branch Product Map
      const products = await prisma.loanProduct.findMany({
        where: { isActive: true },
        include: {
          scheduleTemplates: includeTemplates ? { orderBy: { installmentNo: 'asc' } } : undefined,
          loanProductType: true, // ADD THIS
        },
        orderBy: { createdAt: 'desc' },
      });

      const transformedProducts = products.map(transformProduct);
      return successResponse(transformedProducts, 'Products fetched successfully');
    } catch (error) {
      console.error('Error fetching products:', error);
      return errorResponse('Failed to fetch products', 500);
    }
  })(request);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/products — Create a new loan product (ADMIN only)
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  return withRole(['ADMIN', 'BRANCH_MANAGER'], async () => {
    try {
      const body = await request.json();

      // ── Validation ──
      if (!body.productName?.trim()) {
        return errorResponse('Product Name is required', 400);
      }
      if (!body.loanProductTypeId) {
          return errorResponse('Product Type is required', 400);
      }
      if (!body.loanAmount || Number(body.loanAmount) <= 0) {
        return errorResponse('Loan Amount must be a positive number', 400);
      }
      if (body.interestRate === undefined || body.interestRate === null || Number(body.interestRate) < 0) {
        return errorResponse('Interest Rate is required and must be >= 0', 400);
      }
      if (!body.frequency) {
        return errorResponse('Frequency is required', 400);
      }
      if (!body.numberOfDues || Number(body.numberOfDues) <= 0) {
        return errorResponse('Number of Dues must be a positive number', 400);
      }
      if (!body.loanAmount || Number(body.loanAmount) <= 0) {
        return errorResponse('Loan Amount must be a positive number', 400);
      }
      if (body.interestRate === undefined || body.interestRate === null || Number(body.interestRate) < 0) {
        return errorResponse('Interest Rate is required and must be >= 0', 400);
      }
      if (!body.frequency) {
        return errorResponse('Frequency is required', 400);
      }
      if (!body.numberOfDues || Number(body.numberOfDues) <= 0) {
        return errorResponse('Number of Dues must be a positive number', 400);
      }
      if (body.advanceSavingsAmount !== undefined && Number(body.advanceSavingsAmount) < 0) {
        return errorResponse('Loan Advance cannot be negative', 400);
      }
      const normalizedProductName = body.productName.trim();

      const productType = await prisma.loanProductType.findUnique({
          where: { id: body.loanProductTypeId, isActive: true },
      });

      if (!productType) {
          return errorResponse('Invalid or inactive product type selected', 400);
      }

      // Name must be unique (case-insensitive) among active products.
      const existingByName = await prisma.loanProduct.findFirst({
        where: {
          isActive: true,
          productName: {
            equals: normalizedProductName,
            mode: 'insensitive',
          },
        },
        select: { id: true },
      });
      if (existingByName) {
        return errorResponse('Product Name already exists. Please use a unique name.', 409);
      }

      // ── Auto-generate productId (global numeric sequence) ──
      const existingProducts = await prisma.loanProduct.findMany({ select: { productId: true } });

      const maxNum = existingProducts.reduce((max, p) => {
        if (/^\d+$/.test(p.productId)) {
          const n = parseInt(p.productId, 10);
          return n > max ? n : max;
        }
        return max;
      }, 0);
      const productId = (maxNum + 1).toString().padStart(3, '0');

      // ── Calculate interest amount ──
      const loanAmount = Number(body.loanAmount);
      const interestRate = Number(body.interestRate);
      const numberOfDues = Number(body.numberOfDues);
      const interestMethod = body.interestMethod || 'FLAT';

      let interestAmount = 0;
      if (interestMethod === 'FLAT') {
        // Flat rate: Interest = Principal × Rate / 100
        // The rate is a flat percentage on total principal for the entire loan tenure.
        // Frequency only determines installment intervals, NOT the interest amount.
        interestAmount = (loanAmount * interestRate) / 100;
      } else if (body.interestAmount !== undefined && Number(body.interestAmount) > 0) {
        // For REDUCING method, total interest is provided/calculated from schedule
        interestAmount = Number(body.interestAmount);
      }

      // ── Create product with optional schedule templates ──
      const product = await prisma.loanProduct.create({
        data: {
          productId,
          productName: normalizedProductName,
          loanAmount,
          loanProductTypeId : body.loanProductTypeId,
          interestRate,
          insuranceFees: body.insuranceFees ? Number(body.insuranceFees) : null,
          frequency: body.frequency,
          interestAmount: interestAmount > 0 ? interestAmount : null,
          numberOfDues,
          documentCharges: body.documentCharges ? Number(body.documentCharges) : null,
          interestMethod,
          advanceSavingsAmount: body.advanceSavingsAmount !== undefined ? Number(body.advanceSavingsAmount) : 100,
          status: body.status || 'enabled',
        },
        include: { scheduleTemplates: true },
      });

      // ── Handle schedule templates (for REDUCING balance or custom schedules) ──
      if (body.scheduleTemplates && Array.isArray(body.scheduleTemplates) && body.scheduleTemplates.length > 0) {
        const templates = body.scheduleTemplates.map((t: { installmentNo: number; principalAmount: number; interestAmount: number }) => ({
          productId: product.id,
          installmentNo: Number(t.installmentNo),
          principalAmount: Number(t.principalAmount),
          interestAmount: Number(t.interestAmount),
        }));

        await prisma.productScheduleTemplate.createMany({ data: templates });

        // Recalculate total interest from templates
        const totalInterestFromTemplates = templates.reduce(
          (sum: number, t: { interestAmount: number }) => sum + t.interestAmount,
          0
        );
        if (totalInterestFromTemplates > 0) {
          await prisma.loanProduct.update({
            where: { id: product.id },
            data: { interestAmount: totalInterestFromTemplates },
          });
        }
      }

      // ── Handle branch assignment ──
      // If branchIds are provided and not empty, map only to those branches
      // If branchIds is empty array or not provided, map to ALL branches
      const branchIdsToMap = body.branchIds && Array.isArray(body.branchIds) && body.branchIds.length > 0
        ? body.branchIds
        : null;

      if (branchIdsToMap) {
        // Verify that all provided branch IDs exist and are active
        const validBranches = await prisma.branch.findMany({
          where: { 
            id: { in: branchIdsToMap },
            isActive: true 
          },
          select: { id: true },
        });

        if (validBranches.length > 0) {
          // Map product only to selected branches
          await prisma.branchProductMapping.createMany({
            data: validBranches.map((branch) => ({
              branchId: branch.id,
              productId: product.productId,
              productName: normalizedProductName,
              frequency: body.frequency || null,
              loanAmount: loanAmount || null,
              totalDues: numberOfDues || null,
              interest: interestAmount > 0 ? interestAmount : null,
              isAccessible: true,
            })),
            skipDuplicates: true,
          });
          
          console.log(`Product ${product.productId} mapped to ${validBranches.length} selected branch(es)`);
        } else {
          // No valid branches found for the provided IDs
          console.warn(`No valid active branches found for IDs: ${branchIdsToMap.join(', ')}`);
        }
      } else {
        // No branchIds provided OR empty array -> Map to ALL active branches
        const allBranches = await prisma.branch.findMany({
          where: { isActive: true },
          select: { id: true },
        });

        if (allBranches.length > 0) {
          await prisma.branchProductMapping.createMany({
            data: allBranches.map((branch) => ({
              branchId: branch.id,
              productId: product.productId,
              productName: normalizedProductName,
              frequency: body.frequency || null,
              loanAmount: loanAmount || null,
              totalDues: numberOfDues || null,
              interest: interestAmount > 0 ? interestAmount : null,
              isAccessible: true,
            })),
            skipDuplicates: true,
          });
          
          console.log(`Product ${product.productId} mapped to ALL ${allBranches.length} branches`);
        } else {
          console.warn('No active branches found to map product to');
        }
      }

      // Re-fetch product with templates
      const finalProduct = await prisma.loanProduct.findUnique({
        where: { id: product.id },
        include: { 
          scheduleTemplates: { orderBy: { installmentNo: 'asc' } } 
        },
      });

      return successResponse(transformProduct(finalProduct!), 'Product created successfully', 201);
    } catch (error) {
      console.error('Error creating product:', error);
      return errorResponse('Failed to create product', 500);
    }
  })(request);
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/products — Update an existing loan product (ADMIN only)
// ─────────────────────────────────────────────────────────────────────────────

export async function PUT(request: NextRequest) {
  return withRole(['ADMIN', 'BRANCH_MANAGER'], async () => {
    try {
      const body = await request.json();

      if (!body.productId) {
        return errorResponse('Product ID is required', 400);
      }

      const existingProduct = await prisma.loanProduct.findUnique({
        where: { productId: body.productId },
      });

      if (!existingProduct) {
        return errorResponse('Product not found', 404);
      }

      // Product config is immutable after creation.
      // Only productName and advanceSavingsAmount can be edited.
      const allowedUpdateFields = ['productId', 'productName', 'advanceSavingsAmount'];
      const disallowedFields = Object.keys(body).filter((key) => !allowedUpdateFields.includes(key));
      if (disallowedFields.length > 0) {
        return errorResponse(
          'Only Product Name and Loan Advance can be updated after product creation',
          400
        );
      }
      if (!body.productName?.trim()) {
        return errorResponse('Product Name is required', 400);
      }

      const normalizedProductName = body.productName.trim();
      const duplicateName = await prisma.loanProduct.findFirst({
        where: {
          isActive: true,
          productId: { not: body.productId },
          productName: {
            equals: normalizedProductName,
            mode: 'insensitive',
          },
        },
        select: { id: true },
      });
      if (duplicateName) {
        return errorResponse('Product Name already exists. Please use a unique name.', 409);
      }

      const updateData: any = { productName: normalizedProductName };
      if (body.advanceSavingsAmount !== undefined) {
        updateData.advanceSavingsAmount = Number(body.advanceSavingsAmount);
      }

      const updatedProduct = await prisma.loanProduct.update({
        where: { productId: body.productId },
        data: updateData,
      });

      // Re-fetch with templates
      const finalProduct = await prisma.loanProduct.findUnique({
        where: { id: updatedProduct.id },
        include: { scheduleTemplates: { orderBy: { installmentNo: 'asc' } } },
      });

      return successResponse(transformProduct(finalProduct!), 'Product updated successfully');
    } catch (error) {
      console.error('Error updating product:', error);
      return errorResponse('Failed to update product', 500);
    }
  })(request);
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/products — Soft delete a loan product (ADMIN only)
// ─────────────────────────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  return withRole(['ADMIN', 'BRANCH_MANAGER'], async () => {
    try {
      const { searchParams } = new URL(request.url);
      const productId = searchParams.get('productId');

      if (!productId) {
        return errorResponse('Product ID is required', 400);
      }

      const existingProduct = await prisma.loanProduct.findUnique({
        where: { productId },
        include: {
          loans: { where: { isActive: true }, select: { id: true }, take: 1 },
        },
      });

      if (!existingProduct) {
        return errorResponse('Product not found', 404);
      }

      // Prevent deletion if product has active loans
      if (existingProduct.loans.length > 0) {
        return errorResponse(
          'Cannot delete product with active loans.',
          400
        );
      }

      // Soft delete
      await prisma.loanProduct.update({
        where: { productId },
        data: { isActive: false },
      });

      return successResponse(null, 'Product deleted successfully');
    } catch (error) {
      console.error('Error deleting product:', error);
      return errorResponse('Failed to delete product', 500);
    }
  })(request);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Transform product for API response
// ─────────────────────────────────────────────────────────────────────────────

function transformProduct(product: any) {
  const loanAmount = Number(product.loanAmount);
  const numberOfDues = product.numberOfDues;
  const interestAmount = product.interestAmount ? Number(product.interestAmount) : 0;
  const hasCustomSchedule = product.scheduleTemplates && product.scheduleTemplates.length > 0;

  return {
    id: product.id,
    productId: product.productId,
    productName: product.productName,
    loanProductTypeId: product.loanProductTypeId,
    loanProductType: product.loanProductType ? {
      id: product.loanProductType.id,
      typeId: product.loanProductType.typeId,
      name: product.loanProductType.name,
    } : null,
    loanAmount,
    interestRate: Number(product.interestRate),
    insuranceFees: product.insuranceFees ? Number(product.insuranceFees) : null,
    frequency: product.frequency,
    interestAmount,
    numberOfDues,
    totalDues: numberOfDues, // alias for backward compat
    interest: interestAmount, // alias for backward compat
    documentCharges: product.documentCharges ? Number(product.documentCharges) : null,
    interestMethod: product.interestMethod || 'FLAT',
    advanceSavingsAmount: Number(product.advanceSavingsAmount ?? 100),
    status: product.status || 'enabled',
    loginStatus: product.status || 'enabled', // backward compat
    // Computed per-installment amounts (for FLAT method)
    perInstallmentPrincipal: numberOfDues > 0 ? Number((loanAmount / numberOfDues).toFixed(2)) : 0,
    perInstallmentInterest: numberOfDues > 0 ? Number((interestAmount / numberOfDues).toFixed(2)) : 0,
    totalRepayment: loanAmount + interestAmount,
    // Custom schedule template (for REDUCING method)
    hasCustomSchedule,
    scheduleTemplates: product.scheduleTemplates
      ? product.scheduleTemplates.map((t: any) => ({
          installmentNo: t.installmentNo,
          principalAmount: Number(t.principalAmount),
          interestAmount: Number(t.interestAmount),
          totalAmount: Number(t.principalAmount) + Number(t.interestAmount),
        }))
      : [],
  };
}
