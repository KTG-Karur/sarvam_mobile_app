/** DOB string -> whole years old as of today. Returns null for an empty/invalid input. */
export const calculateAge = (dobStr?: string): number | null => {
    if (!dobStr) return null;
    const dob = new Date(dobStr);
    if (Number.isNaN(dob.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
        age--;
    }
    return age;
};
