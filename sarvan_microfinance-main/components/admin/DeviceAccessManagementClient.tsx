'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Smartphone,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  RefreshCw,
  ShieldAlert,
  History,
  AlertCircle,
  User,
  Building,
  Check,
  X,
} from 'lucide-react';
import { toDisplayDateTime } from '@/app/lib/date-format';

interface DeviceAccessRequest {
  id: string;
  userId: string;
  employeeId: string;
  deviceId: string;
  deviceName: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED';
  rejectionReason: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  user?: {
    id: string;
    employeeId: string | null;
    firstName: string;
    lastName: string;
    role: string;
    mobileDeviceId: string | null;
    branch: { name: string; code: string } | null;
  };
  reviewedBy?: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
}

interface DeviceLoginHistoryItem {
  id: string;
  userId: string;
  employeeId: string;
  deviceId: string;
  deviceName: string | null;
  loginAt: string;
  logoutAt: string | null;
  adminApprovalStatus: string | null;
  user?: {
    id: string;
    employeeId: string | null;
    firstName: string;
    lastName: string;
    role: string;
    branch: { name: string; code: string } | null;
  };
}

export default function DeviceAccessManagementClient() {
  const [activeTab, setActiveTab] = useState<'requests' | 'history'>('requests');

  // Requests state
  const [requests, setRequests] = useState<DeviceAccessRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [searchQuery, setSearchQuery] = useState('');
  const [requestActionLoading, setRequestActionLoading] = useState<string | null>(null);

  // History state
  const [history, setHistory] = useState<DeviceLoginHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState('');

  // Rejection Modal
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  // Message alert
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const fetchRequests = useCallback(async () => {
    setLoadingRequests(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (searchQuery) params.append('search', searchQuery);

      const res = await fetch(`/api/admin/device-access-requests?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setRequests(data.data.requests || []);
      } else {
        setMessage({ text: data.error || 'Failed to fetch device access requests', type: 'error' });
      }
    } catch {
      setMessage({ text: 'Error connecting to server', type: 'error' });
    } finally {
      setLoadingRequests(false);
    }
  }, [statusFilter, searchQuery]);

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const params = new URLSearchParams();
      if (historySearchQuery) params.append('search', historySearchQuery);

      const res = await fetch(`/api/admin/device-login-history?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setHistory(data.data.history || []);
      } else {
        setMessage({ text: data.error || 'Failed to fetch device login history', type: 'error' });
      }
    } catch {
      setMessage({ text: 'Error connecting to server', type: 'error' });
    } finally {
      setLoadingHistory(false);
    }
  }, [historySearchQuery]);

  useEffect(() => {
    if (activeTab === 'requests') {
      fetchRequests();
    } else {
      fetchHistory();
    }
  }, [activeTab, fetchRequests, fetchHistory]);

  const handleAction = async (id: string, action: 'APPROVE' | 'REJECT', reason?: string) => {
    setRequestActionLoading(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/device-access-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, rejectionReason: reason }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({
          text: action === 'APPROVE'
            ? 'Device access request APPROVED successfully! Previous sessions have been revoked.'
            : 'Device access request rejected.',
          type: 'success',
        });
        fetchRequests();
      } else {
        setMessage({ text: data.error || 'Failed to process request', type: 'error' });
      }
    } catch {
      setMessage({ text: 'Network error occurred', type: 'error' });
    } finally {
      setRequestActionLoading(null);
      setRejectModalOpen(false);
      setRejectionReason('');
      setSelectedRequestId(null);
    }
  };

  const pendingCount = requests.filter((r) => r.status === 'PENDING').length;

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-emerald-800 to-teal-900 rounded-2xl p-6 text-white shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-700/50 rounded-xl backdrop-blur-sm border border-emerald-500/30">
              <Smartphone className="w-7 h-7 text-emerald-300" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Single Device Access Control</h1>
              <p className="text-emerald-200 text-sm mt-1">
                Manage mobile device access approvals, device swaps, and single-device login history audit logs.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-white/10 backdrop-blur-md px-4 py-2.5 rounded-xl border border-white/20">
          <ShieldAlert className="w-5 h-5 text-amber-300" />
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-100">
            Strict 1 User = 1 Device Policy Active
          </span>
        </div>
      </div>

      {/* Alert Messages */}
      {message && (
        <div
          className={`p-4 rounded-xl flex items-center justify-between border ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            {message.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            )}
            <span>{message.text}</span>
          </div>
          <button onClick={() => setMessage(null)} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Tabs */}
      <div className="flex border-b border-gray-200 gap-8">
        <button
          onClick={() => setActiveTab('requests')}
          className={`pb-4 px-2 font-semibold text-sm flex items-center gap-2 border-b-2 transition-all ${
            activeTab === 'requests'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          Device Access Requests
          {pendingCount > 0 && (
            <span className="bg-amber-500 text-white text-xs font-bold px-2 py-0.5 rounded-full shadow-sm">
              {pendingCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`pb-4 px-2 font-semibold text-sm flex items-center gap-2 border-b-2 transition-all ${
            activeTab === 'history'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <History className="w-4 h-4" />
          Device Login History
        </button>
      </div>

      {/* TAB 1: DEVICE ACCESS REQUESTS */}
      {activeTab === 'requests' && (
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
              <div className="relative w-full md:w-72">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search Employee ID, Name, Device..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white font-medium text-gray-700"
              >
                <option value="PENDING">Status: Pending Approval</option>
                <option value="APPROVED">Status: Approved</option>
                <option value="REJECTED">Status: Rejected</option>
                <option value="COMPLETED">Status: Completed</option>
                <option value="ALL">Status: All Requests</option>
              </select>
            </div>

            <button
              onClick={fetchRequests}
              disabled={loadingRequests}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-lg transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loadingRequests ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {/* Requests Table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-600 font-semibold border-b border-gray-200 uppercase text-xs">
                  <tr>
                    <th className="px-5 py-3.5">Employee</th>
                    <th className="px-5 py-3.5">Role & Branch</th>
                    <th className="px-5 py-3.5">Requested Device</th>
                    <th className="px-5 py-3.5">Currently Bound Device</th>
                    <th className="px-5 py-3.5">Requested Time</th>
                    <th className="px-5 py-3.5">Status</th>
                    <th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loadingRequests ? (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-gray-500">
                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-600" />
                        Loading device access requests...
                      </td>
                    </tr>
                  ) : requests.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-gray-500">
                        <Smartphone className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                        No device access requests found.
                      </td>
                    </tr>
                  ) : (
                    requests.map((req) => (
                      <tr key={req.id} className="hover:bg-gray-50/80 transition-colors">
                        {/* Employee */}
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-xs">
                              {req.user?.firstName?.[0] || 'U'}
                            </div>
                            <div>
                              <div className="font-semibold text-gray-900">
                                {req.user?.firstName} {req.user?.lastName}
                              </div>
                              <div className="text-xs text-gray-500 font-mono">
                                ID: {req.employeeId}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Role & Branch */}
                        <td className="px-5 py-4">
                          <div className="text-xs font-semibold text-gray-800">
                            {req.user?.role?.replace('_', ' ') || 'N/A'}
                          </div>
                          <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                            <Building className="w-3 h-3" />
                            {req.user?.branch?.name || 'Head Office'}
                          </div>
                        </td>

                        {/* Requested Device */}
                        <td className="px-5 py-4">
                          <div className="font-medium text-gray-900 flex items-center gap-1.5">
                            <Smartphone className="w-4 h-4 text-emerald-600" />
                            {req.deviceName || 'Mobile Device'}
                          </div>
                          <div className="text-[11px] text-gray-400 font-mono mt-0.5 truncate max-w-[200px]">
                            {req.deviceId}
                          </div>
                        </td>

                        {/* Currently Bound Device */}
                        <td className="px-5 py-4">
                          {req.user?.mobileDeviceId ? (
                            <div>
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-gray-100 text-gray-700">
                                {req.user.mobileDeviceId.slice(0, 16)}...
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400 italic">None (Unbound)</span>
                          )}
                        </td>

                        {/* Requested Time */}
                        <td className="px-5 py-4 text-xs text-gray-600 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-gray-400" />
                            {toDisplayDateTime(new Date(req.requestedAt))}
                          </div>
                        </td>

                        {/* Status */}
                        <td className="px-5 py-4">
                          {req.status === 'PENDING' && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                              <Clock className="w-3 h-3 animate-pulse" /> Pending Approval
                            </span>
                          )}
                          {req.status === 'APPROVED' && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3" /> Approved
                            </span>
                          )}
                          {req.status === 'COMPLETED' && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-200">
                              <CheckCircle2 className="w-3 h-3" /> Swap Completed
                            </span>
                          )}
                          {req.status === 'REJECTED' && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-200">
                              <XCircle className="w-3 h-3" /> Rejected
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-5 py-4 text-right">
                          {req.status === 'PENDING' ? (
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleAction(req.id, 'APPROVE')}
                                disabled={requestActionLoading === req.id}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all disabled:opacity-50"
                              >
                                <Check className="w-3.5 h-3.5" /> Approve
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedRequestId(req.id);
                                  setRejectModalOpen(true);
                                }}
                                disabled={requestActionLoading === req.id}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold rounded-lg transition-all disabled:opacity-50"
                              >
                                <X className="w-3.5 h-3.5" /> Reject
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400 italic">No actions available</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: DEVICE LOGIN HISTORY */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="relative w-full md:w-80">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search Employee ID, Name, Device..."
                value={historySearchQuery}
                onChange={(e) => setHistorySearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
              />
            </div>

            <button
              onClick={fetchHistory}
              disabled={loadingHistory}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-lg transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loadingHistory ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {/* History Table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-600 font-semibold border-b border-gray-200 uppercase text-xs">
                  <tr>
                    <th className="px-5 py-3.5">Employee</th>
                    <th className="px-5 py-3.5">Device ID & Model</th>
                    <th className="px-5 py-3.5">Login Time</th>
                    <th className="px-5 py-3.5">Logout Time / Session</th>
                    <th className="px-5 py-3.5">Approval Mode</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loadingHistory ? (
                    <tr>
                      <td colSpan={5} className="text-center py-12 text-gray-500">
                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-600" />
                        Loading login history audit logs...
                      </td>
                    </tr>
                  ) : history.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-12 text-gray-500">
                        <History className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                        No login history logs recorded yet.
                      </td>
                    </tr>
                  ) : (
                    history.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50/80 transition-colors">
                        {/* Employee */}
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-700 font-bold flex items-center justify-center text-xs">
                              <User className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="font-semibold text-gray-900">
                                {item.user?.firstName} {item.user?.lastName}
                              </div>
                              <div className="text-xs text-gray-500 font-mono">
                                ID: {item.employeeId}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Device Info */}
                        <td className="px-5 py-4">
                          <div className="font-medium text-gray-900 flex items-center gap-1.5">
                            <Smartphone className="w-4 h-4 text-gray-500" />
                            {item.deviceName || 'Mobile Device'}
                          </div>
                          <div className="text-[11px] text-gray-400 font-mono mt-0.5 truncate max-w-[240px]">
                            {item.deviceId}
                          </div>
                        </td>

                        {/* Login Time */}
                        <td className="px-5 py-4 text-xs text-gray-700 whitespace-nowrap">
                          {toDisplayDateTime(new Date(item.loginAt))}
                        </td>

                        {/* Logout Time */}
                        <td className="px-5 py-4 whitespace-nowrap">
                          {item.logoutAt ? (
                            <span className="text-xs text-gray-500">
                              {toDisplayDateTime(new Date(item.logoutAt))}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-800">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" /> Active Session
                            </span>
                          )}
                        </td>

                        {/* Approval Status */}
                        <td className="px-5 py-4">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                            {item.adminApprovalStatus || 'DIRECT_LOGIN'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Rejection Modal */}
      {rejectModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 border border-gray-100">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <XCircle className="w-5 h-5 text-rose-600" /> Reject Device Access Request
              </h3>
              <button onClick={() => setRejectModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-gray-600">
              Please enter an optional rejection reason for the employee:
            </p>

            <textarea
              rows={3}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="e.g. Unrecognized mobile device. Please contact Head Office..."
              className="w-full p-3 border border-gray-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
            />

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setRejectModalOpen(false)}
                className="px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => selectedRequestId && handleAction(selectedRequestId, 'REJECT', rejectionReason)}
                className="px-4 py-2 text-sm font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-sm transition-colors"
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
