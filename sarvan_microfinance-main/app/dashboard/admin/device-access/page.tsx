import DeviceAccessManagementClient from '@/components/admin/DeviceAccessManagementClient';

export const metadata = {
  title: 'Single Device Access Control | Sarvam Admin',
  description: 'Manage single device login enforcement, access swap approvals, and device login audit logs.',
};

export default function DeviceAccessPage() {
  return <DeviceAccessManagementClient />;
}
