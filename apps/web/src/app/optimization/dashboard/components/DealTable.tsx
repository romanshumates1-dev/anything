interface Deal {
  id: number;
  name: string;
  address: string;
  score: number;
  arv: number;
  offerMax: number;
  pClose: number;
  expectedValue: number;
  status: string;
}

interface DealTableProps {
  deals: Deal[];
}

export function DealTable({ deals }: DealTableProps) {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-xl font-semibold">Deal Pipeline</h2>
        <p className="text-sm text-gray-600 mt-1">Sorted by Expected Value</p>
      </div>

      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lead</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Score</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ARV</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Offer</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">P(Close)</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">EV</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {deals.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                No deals yet. Process some leads to see them here.
              </td>
            </tr>
          ) : (
            deals.map(deal => {
              const evColor =
                deal.expectedValue > 5000 ? 'text-green-600' :
                deal.expectedValue > 2000 ? 'text-yellow-600' : 'text-gray-600';

              return (
                <tr key={deal.id} className="hover:bg-gray-50 cursor-pointer">
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-gray-900">{deal.name}</div>
                    <div className="text-xs text-gray-500">{deal.address}</div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {Math.round(deal.score * 100)}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    ${Math.round(deal.arv / 100).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    ${Math.round(deal.offerMax / 100).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {(deal.pClose * 100).toFixed(1)}%
                  </td>
                  <td className={`px-6 py-4 text-sm font-semibold ${evColor}`}>
                    ${Math.round(deal.expectedValue / 100).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {deal.status}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
