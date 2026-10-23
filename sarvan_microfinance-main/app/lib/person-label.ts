/**
 * A person is a "Member" before they have any Loan record, and a "Client"
 * once at least one Loan exists for them (any status, not just disbursed).
 */
export function getPersonLabel(hasLoan: boolean) {
  return {
    singular: hasLoan ? 'Client' : 'Member',
    plural: hasLoan ? 'Clients' : 'Members',
  };
}
