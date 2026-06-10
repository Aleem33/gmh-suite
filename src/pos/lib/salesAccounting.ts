export function getGrossSubtotal(sale: any): number {
  if (sale?.grossSubtotal != null) return Number(sale.grossSubtotal) || 0;
  return (Number(sale?.subtotal) || 0) + (Number(sale?.totalItemDiscounts) || 0);
}

export function getReturnsForSale(returns: any[], saleId: string) {
  return returns.filter(r => r.originalSaleId === saleId);
}

export function getSaleReturnTotal(sale: any, returns: any[]): number {
  return getReturnsForSale(returns, sale.id).reduce((sum, r) => sum + (Number(r.totalRefund) || 0), 0);
}

export function getItemReturnTotals(returns: any[], saleId: string, cartItemId: string) {
  return getReturnsForSale(returns, saleId)
    .flatMap(r => r.items || [])
    .filter((item: any) => item.cartItemId === cartItemId)
    .reduce((acc, item: any) => ({
      quantity: acc.quantity + (Number(item.returnQty) || 0),
      amount: acc.amount + (Number(item.refundAmount) || 0),
    }), { quantity: 0, amount: 0 });
}

export function getSaleAccounting(sale: any, returns: any[]) {
  const grossSubtotal = getGrossSubtotal(sale);
  const grossTotal = Number(sale?.total) || 0;
  const returnTotal = Math.min(grossTotal, getSaleReturnTotal(sale, returns));
  const originalPending = Number(sale?.pendingAmount) || 0;
  const originalPaid = sale?.amountPaid == null ? grossTotal : Number(sale.amountPaid) || 0;
  const pendingReduction = Math.min(originalPending, returnTotal);
  const refundableAmount = Math.max(0, returnTotal - pendingReduction);
  const netTotal = Math.max(0, grossTotal - returnTotal);
  const netPending = Math.max(0, originalPending - pendingReduction);
  const netPaid = Math.max(0, Math.min(netTotal, originalPaid - refundableAmount));

  return {
    grossSubtotal,
    grossTotal,
    returnTotal,
    netTotal,
    originalPaid,
    netPaid,
    originalPending,
    netPending,
    pendingReduction,
    refundableAmount,
  };
}

export function getNetItemAmount(sale: any, item: any, returns: any[]): number {
  if (!item) return 0;
  const itemReturns = getItemReturnTotals(returns, sale.id, item.cartItemId);
  return Math.max(0, (Number(item.total) || 0) - itemReturns.amount);
}

export function getNetItemQuantity(sale: any, item: any, returns: any[]): number {
  if (!item) return 0;
  const itemReturns = getItemReturnTotals(returns, sale.id, item.cartItemId);
  return Math.max(0, (Number(item.quantity) || 0) - itemReturns.quantity);
}

export function getNetSalesTotal(sales: any[], returns: any[]): number {
  return sales.reduce((sum, sale) => sum + getSaleAccounting(sale, returns).netTotal, 0);
}

export function getReturnsTotalForSales(sales: any[], returns: any[]): number {
  return sales.reduce((sum, sale) => sum + getSaleAccounting(sale, returns).returnTotal, 0);
}
