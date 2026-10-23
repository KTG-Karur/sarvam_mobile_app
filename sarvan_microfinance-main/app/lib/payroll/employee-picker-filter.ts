export type EmployeeOption = { id: string; name: string };

/** Rows the employee picker draws at once. The full list stays searchable; this only bounds the browser's render work. */
export const EMPLOYEE_PICKER_MAX_ROWS = 50;

/** Case-insensitive match on the displayed name (which carries the employee name and role). */
export function filterEmployeeOptions(employees: EmployeeOption[], query: string): EmployeeOption[] {
    const q = query.trim().toLowerCase();
    return q ? employees.filter((e) => e.name.toLowerCase().includes(q)) : employees;
}
