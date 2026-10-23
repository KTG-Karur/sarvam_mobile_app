'use client';

import { useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { User, UserRole } from '@/app/types';

export interface RbacRoleSummary {
  id: string;
  name: string;
  slug: string;
  color: string | null;
}

export interface UserWithBranch extends User {
  branch?: {
    id: string;
    name: string;
    code: string;
  } | null;
  /** Active RBAC role from UserRoleAssignment — shown instead of legacy role enum for custom roles */
  rbacRole?: RbacRoleSummary | null;
}

interface UseUserManagementOptions {
  onSuccess?: () => void;
}

interface UsersPageResponse {
  users: UserWithBranch[];
  totalCount: number;
  totalPages: number;
  page: number;
  pageSize: number;
}

export function useUserManagement(options?: UseUserManagementOptions) {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserWithBranch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserWithBranch | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);

  const fetchUsers = useCallback(async (filters?: {
    role?: UserRole;
    branchId?: string;
    isActive?: boolean;
    search?: string;
    searchField?: 'mobile' | 'email';
    page?: number;
    pageSize?: number;
  }) => {
    setIsLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (filters?.role) queryParams.append('role', filters.role);
      if (filters?.branchId) queryParams.append('branchId', filters.branchId);
      if (filters?.isActive !== undefined) queryParams.append('isActive', String(filters.isActive));
      if (filters?.search) queryParams.append('search', filters.search);
      if (filters?.searchField) queryParams.append('searchField', filters.searchField);
      queryParams.append('page', String(filters?.page ?? 1));
      queryParams.append('pageSize', String(filters?.pageSize ?? 10));

      const endpoint = `/users${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      const result = await apiClient.get<UsersPageResponse>(endpoint);

      if (result.success && result.data) {
        setUsers(result.data.users);
        setTotalCount(result.data.totalCount);
        setTotalPages(result.data.totalPages);
        setPage(result.data.page);
        return result.data.users;
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to fetch users',
          variant: 'destructive',
        });
        return [];
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      toast({
        title: 'Error',
        description: 'Network error. Please try again.',
        variant: 'destructive',
      });
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const createUser = useCallback(async (userData: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    branchId?: string | null;
  }) => {
    setIsLoading(true);
    try {
      const result = await apiClient.post<UserWithBranch>('/users', userData);
      
      if (result.success && result.data) {
        toast({
          title: 'Success',
          description: 'User created successfully',
        });
        options?.onSuccess?.();
        return result.data;
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to create user',
          variant: 'destructive',
        });
        return null;
      }
    } catch (error) {
      console.error('Error creating user:', error);
      toast({
        title: 'Error',
        description: 'Network error. Please try again.',
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [toast, options]);

  const updateUser = useCallback(async (userId: string, userData: {
    mobileNumber?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    role?: UserRole;
    branchId?: string | null;
    isActive?: boolean;
    rbacRoleId?: string;
    fatherName?: string;
    motherName?: string;
    address?: string;
    education?: string;
    aadhaarNumber?: string;
    aadhaarDocUrl?: string;
    panNumber?: string;
    panDocUrl?: string;
    profilePhotoUrl?: string;
    esiNumber?: string;
    pfNumber?: string;
    esiPfDocUrl?: string;
  }) => {
    setIsLoading(true);
    try {
      const result = await apiClient.patch<UserWithBranch>(`/users/${userId}`, userData);
      
      if (result.success && result.data) {
        toast({
          title: 'Success',
          description: 'User updated successfully',
        });
        options?.onSuccess?.();
        return result.data;
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to update user',
          variant: 'destructive',
        });
        return null;
      }
    } catch (error) {
      console.error('Error updating user:', error);
      toast({
        title: 'Error',
        description: 'Network error. Please try again.',
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [toast, options]);

  const resetPassword = useCallback(async (userId: string, newPassword: string) => {
    setIsLoading(true);
    try {
      const result = await apiClient.post(`/users/${userId}/reset-password`, {
        newPassword,
      });
      
      if (result.success) {
        toast({
          title: 'Success',
          description: 'Password reset successfully',
        });
        return true;
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to reset password',
          variant: 'destructive',
        });
        return false;
      }
    } catch (error) {
      console.error('Error resetting password:', error);
      toast({
        title: 'Error',
        description: 'Network error. Please try again.',
        variant: 'destructive',
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const assignBranch = useCallback(async (userId: string, branchId: string | null) => {
    setIsLoading(true);
    try {
      const result = await apiClient.post<UserWithBranch>(`/users/${userId}/assign-branch`, {
        branchId,
      });
      
      if (result.success && result.data) {
        toast({
          title: 'Success',
          description: 'Branch assigned successfully',
        });
        options?.onSuccess?.();
        return result.data;
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to assign branch',
          variant: 'destructive',
        });
        return null;
      }
    } catch (error) {
      console.error('Error assigning branch:', error);
      toast({
        title: 'Error',
        description: 'Network error. Please try again.',
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [toast, options]);

  const suspendUser = useCallback(async (userId: string, isActive: boolean) => {
    setIsLoading(true);
    try {
      const result = await apiClient.post<UserWithBranch>(`/users/${userId}/suspend`, {
        isActive,
      });
      
      if (result.success && result.data) {
        toast({
          title: 'Success',
          description: isActive ? 'User activated successfully' : 'User suspended successfully',
        });
        options?.onSuccess?.();
        return result.data;
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to update user status',
          variant: 'destructive',
        });
        return null;
      }
    } catch (error) {
      console.error('Error updating user status:', error);
      toast({
        title: 'Error',
        description: 'Network error. Please try again.',
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [toast, options]);

  const deleteUser = useCallback(async (userId: string) => {
    setIsLoading(true);
    try {
      const result = await apiClient.delete(`/users/${userId}`);
      
      if (result.success) {
        toast({
          title: 'Success',
          description: 'User deleted successfully',
        });
        options?.onSuccess?.();
        return true;
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to delete user',
          variant: 'destructive',
        });
        return false;
      }
    } catch (error) {
      console.error('Error deleting user:', error);
      toast({
        title: 'Error',
        description: 'Network error. Please try again.',
        variant: 'destructive',
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [toast, options]);

  return {
    users,
    isLoading,
    selectedUser,
    setSelectedUser,
    fetchUsers,
    createUser,
    updateUser,
    resetPassword,
    assignBranch,
    suspendUser,
    deleteUser,
    totalCount,
    totalPages,
    page,
  };
}
