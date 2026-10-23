export const formatCurrency = (amount: number): string => {
  if (amount === 0) return "0";
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

export const formatTime = (timeString: string): string => {
  if (!timeString) return "";
  const time = timeString.replace("Z", "");
  return time.substring(0, 5);
};
