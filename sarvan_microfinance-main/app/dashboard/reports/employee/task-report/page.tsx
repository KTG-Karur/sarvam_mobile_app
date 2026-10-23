import { protectServerRoute } from '@/app/lib/server-route-protection';
import { TaskReportClient } from '@/components/reports/TaskReportClient';

export default async function TaskReportPage() {
  await protectServerRoute('/dashboard/reports/employee/task-report');

  return <TaskReportClient />;
}
