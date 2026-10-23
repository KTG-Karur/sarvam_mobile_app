import crypto from 'crypto';
import { prisma } from '@/app/lib/prisma';
import type { HighmarkReport } from '@prisma/client';

export interface HighmarkConfigDTO {
  pullLimitPerAadhaar: number;
  limitWindowDays: number;
  freshnessWindowDays: number;
  enforcementMode: 'BLOCK' | 'WARN';
  limitedRoles: string[];
}

const DEFAULT_HIGHMARK_CONFIG: HighmarkConfigDTO = {
  pullLimitPerAadhaar: 3,
  limitWindowDays: 180,
  freshnessWindowDays: 60,
  enforcementMode: 'BLOCK',
  limitedRoles: ['BRANCH_MANAGER', 'FDO'],
};

export interface RunCreditCheckInput {
  firstName: string;
  lastName?: string;
  aadhaar: string;
  phone: string;
  consentObtained: boolean;
  clientId?: string;
  requestedById: string;
  requestedByRole: string;
  branchId: string;
}

export class RateLimitExceededError extends Error {
  constructor(public readonly limit: number, public readonly windowDays: number) {
    super(`This Aadhaar has already been checked ${limit} time(s) in the last ${windowDays} days. Ask an Area Manager to override.`);
    this.name = 'RateLimitExceededError';
  }
}

/** Thrown once the request actually reaches (or is sent toward) CRIF — Surepass bills per hit regardless of outcome. */
export class CrifRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrifRequestError';
  }
}

/**
 * Highmark (CRIF SurepassCrif) integration.
 * Every pull is one HighmarkReport row — history is just those rows over time,
 * so there is no separate history table to maintain.
 */
export class HighmarkService {
  hashAadhaar(aadhaar: string): string {
    return crypto.createHash('sha256').update(aadhaar.trim()).digest('hex');
  }

  maskAadhaar(aadhaar: string): string {
    const digits = aadhaar.trim();
    return `${'*'.repeat(Math.max(digits.length - 4, 0))}${digits.slice(-4)}`;
  }

  async getConfig(): Promise<HighmarkConfigDTO> {
    const config = await prisma.highmarkConfig.findFirst();
    if (!config) return DEFAULT_HIGHMARK_CONFIG;
    return {
      pullLimitPerAadhaar: config.pullLimitPerAadhaar,
      limitWindowDays: config.limitWindowDays,
      freshnessWindowDays: config.freshnessWindowDays,
      enforcementMode: config.enforcementMode as 'BLOCK' | 'WARN',
      limitedRoles: config.limitedRoles,
    };
  }

  async saveConfig(input: HighmarkConfigDTO): Promise<HighmarkConfigDTO> {
    const existing = await prisma.highmarkConfig.findFirst();
    const result = existing
      ? await prisma.highmarkConfig.update({ where: { id: existing.id }, data: input })
      : await prisma.highmarkConfig.create({ data: input });
    return {
      pullLimitPerAadhaar: result.pullLimitPerAadhaar,
      limitWindowDays: result.limitWindowDays,
      freshnessWindowDays: result.freshnessWindowDays,
      enforcementMode: result.enforcementMode as 'BLOCK' | 'WARN',
      limitedRoles: result.limitedRoles,
    };
  }

  private async findFreshReport(aadhaarHash: string, freshnessWindowDays: number): Promise<HighmarkReport | null> {
    const since = new Date(Date.now() - freshnessWindowDays * 24 * 60 * 60 * 1000);
    return prisma.highmarkReport.findFirst({
      where: { aadhaarHash, status: 'Completed', pulledAt: { gte: since } },
      orderBy: { pulledAt: 'desc' },
    });
  }

  /**
   * Read-only lookup used by enrollment (and any FDO/BM screen) to auto-display an
   * already-pulled report for this Aadhaar — pulled by *any* FDO/branch — instead of
   * triggering a new paid bureau call. Honors the same freshness window as runCheck's
   * reuse step (Highmark Settings > freshnessWindowDays), so it never surfaces a stale
   * report. Does not require consent since no new bureau pull happens here.
   */
  async getReusableReport(aadhaar: string): Promise<HighmarkReport | null> {
    const config = await this.getConfig();
    return this.findFreshReport(this.hashAadhaar(aadhaar), config.freshnessWindowDays);
  }

  private async countRecentPulls(aadhaarHash: string, role: string, windowDays: number): Promise<number> {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    return prisma.highmarkReport.count({
      where: {
        aadhaarHash,
        status: 'Completed',
        pulledAt: { gte: since },
        requestedBy: { role },
      },
    });
  }

  /** Fixed per-pull cost charged by Surepass: ₹23.50 + 18% GST = ₹27.73. Overridable via env if pricing changes. */
  private get costPerPull(): number {
    const configured = Number(process.env.CRIF_COST_PER_PULL);
    return Number.isFinite(configured) && configured > 0 ? configured : 27.73;
  }

  private async callCrif(input: { firstName: string; lastName?: string; aadhaar: string; phone: string; consentObtained: boolean }) {
    const apiKey = process.env.CRIF_API_KEY;
    const apiUrl = process.env.CRIF_API_URL || 'https://kyc-api.surepass.app/api/v1/credit-report-crif/fetch-report';
    // No request sent yet — not a billable hit.
    if (!apiKey) throw new Error('CRIF_API_KEY environment variable is not set.');

    let response: Response;
    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          first_name: input.firstName,
          last_name: input.lastName || '',
          mobile: input.phone,
          aadhaar_number: input.aadhaar,
          consent: input.consentObtained ? 'Y' : 'N',
        }),
        cache: 'no-store',
      });
    } catch (networkError: any) {
      // Request was sent to Surepass — billable even though we never got a response back.
      throw new CrifRequestError(networkError?.message || 'Network error calling CRIF');
    }

    const body = (await response.json().catch(() => null)) as {
      data?: {
        client_id?: string;
        credit_score?: string | null;
        credit_report?: unknown;
      };
      success?: boolean;
      message?: string | null;
    } | null;

    if (!response.ok || !body?.success || !body.data) {
      // Surepass processed and answered the request — still a billable hit even though it failed.
      throw new CrifRequestError(body?.message || `CRIF credit report request failed (${response.status})`);
    }

    const { data } = body;
    const header = (data.credit_report as { HEADER?: { STATUS?: string } } | undefined)?.HEADER;

    return {
      pullId: Math.floor(Date.now() / 1000),
      provider: 'SurepassCrif',
      status: header?.STATUS === 'SUCCESS' ? 'Completed' : 'Failed',
      creditScore: data.credit_score ?? null,
      providerReference: data.client_id ?? null,
      creditsCharged: this.costPerPull,
      fromCache: false,
      reportJson: data.credit_report,
    };
  }

  /**
   * Every attempt gets a row — including ones that never reach CRIF (rate-limit block)
   * or that CRIF/network rejects — so the Highmark Log shows a complete audit trail, not
   * just successful pulls. Negative pullId keeps these out of the way of real provider
   * pullIds (always positive) under the (pullId, provider) unique constraint.
   */
  private async logFailedAttempt(
    input: RunCreditCheckInput,
    aadhaarHash: string,
    status: string,
    message: string,
    creditsCharged = 0
  ): Promise<void> {
    try {
      await prisma.highmarkReport.create({
        data: {
          pullId: -Math.floor(Date.now() / 1000),
          provider: 'SurepassCrif',
          status,
          fromCache: false,
          providerReference: null,
          creditScore: null,
          creditsCharged,
          reportJson: { error: message },
          firstName: input.firstName,
          lastName: input.lastName || null,
          aadhaarHash,
          aadhaarMasked: this.maskAadhaar(input.aadhaar),
          phone: input.phone,
          consentObtained: true,
          consentAt: new Date(),
          requestedById: input.requestedById,
          branchId: input.branchId,
          clientId: input.clientId || null,
          pulledAt: new Date(),
        },
      });
    } catch (logError) {
      console.error('Failed to log Highmark check failure:', logError);
    }
  }

  /**
   * Runs the full flow: reuse a fresh report if one exists, otherwise enforce the
   * per-Aadhaar/per-role rate limit and, if it passes, call CRIF and store the result.
   */
  async runCheck(input: RunCreditCheckInput): Promise<{ reused: boolean; report: HighmarkReport }> {
    if (!input.consentObtained) {
      throw new Error('Consent is required before running a credit check.');
    }

    const aadhaarHash = this.hashAadhaar(input.aadhaar);
    const config = await this.getConfig();

    const fresh = await this.findFreshReport(aadhaarHash, config.freshnessWindowDays);
    if (fresh) {
      if (input.clientId && !fresh.clientId) {
        return { reused: true, report: await prisma.highmarkReport.update({ where: { id: fresh.id }, data: { clientId: input.clientId } }) };
      }
      return { reused: true, report: fresh };
    }

    if (config.limitedRoles.includes(input.requestedByRole)) {
      const recentCount = await this.countRecentPulls(aadhaarHash, input.requestedByRole, config.limitWindowDays);
      if (recentCount >= config.pullLimitPerAadhaar && config.enforcementMode === 'BLOCK') {
        const err = new RateLimitExceededError(config.pullLimitPerAadhaar, config.limitWindowDays);
        await this.logFailedAttempt(input, aadhaarHash, 'Blocked', err.message);
        throw err;
      }
    }

    const consentAt = new Date();
    let crifResult;
    try {
      crifResult = await this.callCrif(input);
    } catch (error: any) {
      // Billable only once the request actually went out to Surepass (CrifRequestError) —
      // config errors (e.g. missing API key) never leave our server, so no charge applies.
      const charged = error instanceof CrifRequestError ? this.costPerPull : 0;
      await this.logFailedAttempt(input, aadhaarHash, 'Error', error?.message || 'Credit report request failed', charged);
      throw error;
    }

    const report = await prisma.highmarkReport.create({
      data: {
        pullId: crifResult.pullId,
        provider: crifResult.provider || 'SurepassCrif',
        status: crifResult.status,
        fromCache: crifResult.fromCache ?? false,
        providerReference: crifResult.providerReference,
        creditScore: crifResult.creditScore ? parseInt(crifResult.creditScore, 10) : null,
        creditsCharged: crifResult.creditsCharged ?? 0,
        reportJson: crifResult.reportJson as object,
        firstName: input.firstName,
        lastName: input.lastName || null,
        aadhaarHash,
        aadhaarMasked: this.maskAadhaar(input.aadhaar),
        phone: input.phone,
        consentObtained: true,
        consentAt,
        requestedById: input.requestedById,
        branchId: input.branchId,
        clientId: input.clientId || null,
        pulledAt: new Date(),
      },
    });

    return { reused: false, report };
  }

  private isClientCuid(clientIdOrCuid: string): boolean {
    return /^c[a-z0-9]{24}$/i.test(clientIdOrCuid) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientIdOrCuid);
  }

  /**
   * Runs a Highmark check for a client already on file — pulls firstName/lastName/
   * Aadhaar/phone straight from the Client record so the caller only needs to hand
   * over the id. Used by the "Recheck" action on client-detail screens. Goes through
   * the same freshness-window reuse as every other check (runCheck() / Masters >
   * Highmark Settings): if the last report for this Aadhaar is still within that
   * window, it's reused as-is — no new (billable) CRIF pull — otherwise a fresh one
   * is fetched.
   */
  async runCheckForClient(input: {
    clientIdOrCuid: string;
    consentObtained: boolean;
    requestedById: string;
    requestedByRole: string;
    branchId: string;
  }): Promise<{ reused: boolean; report: HighmarkReport }> {
    const client = await prisma.client.findFirst({
      where: this.isClientCuid(input.clientIdOrCuid) ? { id: input.clientIdOrCuid } : { clientId: input.clientIdOrCuid },
      orderBy: { createdAt: 'asc' },
      select: { id: true, firstName: true, lastName: true, otherIdNo: true, mobileNumber: true, phone: true },
    });
    if (!client) throw new Error('Client not found');

    const aadhaar = (client.otherIdNo || '').replace(/\D/g, '');
    const phone = (client.mobileNumber || client.phone || '').replace(/\D/g, '');
    if (!/^\d{12}$/.test(aadhaar)) throw new Error('This client has no valid 12-digit Aadhaar on file — cannot run a Highmark check.');
    if (!/^\d{10}$/.test(phone)) throw new Error('This client has no valid 10-digit mobile number on file — cannot run a Highmark check.');

    return this.runCheck({
      firstName: client.firstName,
      lastName: client.lastName || undefined,
      aadhaar,
      phone,
      consentObtained: input.consentObtained,
      clientId: client.id,
      requestedById: input.requestedById,
      requestedByRole: input.requestedByRole,
      branchId: input.branchId,
    });
  }

  /**
   * Accepts either the Client cuid or the human-facing business clientId (e.g. "C000123") —
   * same dual-lookup convention as GET /api/clients/[clientId]/*, so every screen that
   * already has one or the other on hand can link here without a resolver round-trip.
   *
   * Also self-heals: a report pulled before this client existed (e.g. via the standalone
   * Run Credit Check screen) or run without a clientId is stored with clientId = null and
   * only findable by Aadhaar. On lookup, any such orphaned report matching this client's
   * Aadhaar is auto-linked so it shows up here — and in the register's "Client" column —
   * from then on.
   */
  async getHistoryForClient(clientIdOrCuid: string): Promise<HighmarkReport[]> {
    const client = await prisma.client.findFirst({
      where: this.isClientCuid(clientIdOrCuid) ? { id: clientIdOrCuid } : { clientId: clientIdOrCuid },
      orderBy: { createdAt: 'asc' },
      select: { id: true, otherIdNo: true },
    });
    if (!client) return [];

    if (client.otherIdNo) {
      await prisma.highmarkReport.updateMany({
        where: { aadhaarHash: this.hashAadhaar(client.otherIdNo), clientId: null },
        data: { clientId: client.id },
      });
    }

    return prisma.highmarkReport.findMany({ where: { clientId: client.id }, orderBy: { pulledAt: 'desc' } });
  }

  async getHistoryForAadhaar(aadhaar: string): Promise<HighmarkReport[]> {
    return prisma.highmarkReport.findMany({
      where: { aadhaarHash: this.hashAadhaar(aadhaar) },
      orderBy: { pulledAt: 'desc' },
    });
  }

  async getRegister(params: {
    /** Role-derived scope — always enforced, never widened by the filters below. */
    branchIds?: string[];
    /** User-picked narrowing filters. */
    branchId?: string;
    centerId?: string;
    fromDate?: Date;
    toDate?: Date;
    aadhaar?: string;
    phone?: string;
    clientId?: string;
    skip?: number;
    take?: number;
  }) {
    let branchIds = params.branchIds;
    if (params.branchId) {
      branchIds = branchIds ? branchIds.filter((id) => id === params.branchId) : [params.branchId];
    }

    const where: Record<string, unknown> = {};
    if (branchIds) where.branchId = { in: branchIds };

    // Resolved against Client directly (not a nested `client: {...}` relation filter) —
    // a nested filter on a nullable FK silently requires the relation to exist and match,
    // which would drop any report whose clientId is currently unset (e.g. an enrollment
    // credit check pulled before the client record was finalized) even though the report
    // itself is never deleted. Resolving to an explicit id list keeps that distinction
    // visible instead of making the row disappear from filtered searches.
    if (params.centerId || params.clientId) {
      const clientWhere: Record<string, unknown> = {};
      if (params.centerId) clientWhere.centerId = params.centerId;
      if (params.clientId) clientWhere.clientId = { contains: params.clientId, mode: 'insensitive' };
      const matchingClients = await prisma.client.findMany({ where: clientWhere, select: { id: true } });
      where.clientId = { in: matchingClients.map((c) => c.id) };
    }
    if (params.fromDate || params.toDate) {
      where.pulledAt = {
        ...(params.fromDate ? { gte: params.fromDate } : {}),
        ...(params.toDate ? { lte: params.toDate } : {}),
      };
    }
    if (params.phone) where.phone = { contains: params.phone };
    if (params.aadhaar) {
      const digits = params.aadhaar.replace(/\D/g, '');
      if (digits.length === 12) {
        where.aadhaarHash = this.hashAadhaar(digits);
      } else if (digits.length > 0) {
        where.aadhaarMasked = { contains: digits };
      }
    }

    const [items, total, costAgg] = await Promise.all([
      prisma.highmarkReport.findMany({
        where,
        orderBy: [
          { pulledAt: 'desc' },
          { id: 'asc' },
        ],
        skip: params.skip ?? 0,
        take: params.take ?? 50,
        include: {
          requestedBy: { select: { firstName: true, lastName: true } },
          branch: { select: { name: true, code: true } },
          client: { select: { clientId: true, firstName: true, lastName: true } },
        },
      }),
      prisma.highmarkReport.count({ where }),
      prisma.highmarkReport.aggregate({ where, _sum: { creditsCharged: true } }),
    ]);
    const totalCost = Number(costAgg._sum.creditsCharged ?? 0);
    return { items, total, totalCost };
  }
}

export const highmarkService = new HighmarkService();
