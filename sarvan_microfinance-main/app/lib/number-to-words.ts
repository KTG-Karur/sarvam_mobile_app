/**
 * Converts a rupee amount to words using the Indian numbering system
 * (Thousand / Lakh / Crore), e.g. 1234567.5 -> "Twelve Lakh Thirty Four
 * Thousand Five Hundred Sixty Seven and Fifty Paise".
 */
export function amountToWords(amount: number): string {
    const ones = [
        '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
        'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
        'Seventeen', 'Eighteen', 'Nineteen',
    ];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    const toWords = (n: number): string => {
        if (n === 0) return '';
        if (n < 20) return ones[n] + ' ';
        if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '') + ' ';
        if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred ' + toWords(n % 100);
        if (n < 100000) return toWords(Math.floor(n / 1000)) + 'Thousand ' + toWords(n % 1000);
        if (n < 10000000) return toWords(Math.floor(n / 100000)) + 'Lakh ' + toWords(n % 100000);
        return toWords(Math.floor(n / 10000000)) + 'Crore ' + toWords(n % 10000000);
    };

    const rupees = Math.floor(Math.abs(amount));
    const paise = Math.round((Math.abs(amount) - rupees) * 100);

    let result = toWords(rupees).trim();
    if (!result) result = 'Zero';
    if (paise > 0) result += ` and ${toWords(paise).trim()} Paise`;
    return result;
}
