import { protectServerRoute } from '@/app/lib/server-route-protection';
import { FdoTaskManagementClient } from '@/components/masters/FdoTaskManagementClient';

export default async function FdoTasksPage() {
  await protectServerRoute('/dashboard/hr/performance/tasks');

  return <FdoTaskManagementClient />;
}
