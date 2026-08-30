interface Action {
  id: number;
  leadId: number;
  leadName: string;
  address: string;
  action: string;
  priority: number;
  reason: any;
  createdAt: Date;
}

interface ActionQueueProps {
  actions: Action[];
}

export function ActionQueue({ actions }: ActionQueueProps) {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-xl font-semibold">Action Queue</h2>
        <p className="text-sm text-gray-600 mt-1">What to do next (sorted by priority)</p>
      </div>

      <div className="divide-y divide-gray-200">
        {actions.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500">
            No actions queued. Process some leads to generate actions.
          </div>
        ) : (
          actions.map((action, index) => {
            const priorityColor =
              action.priority > 5000 ? 'bg-green-100 text-green-800' :
              action.priority > 2000 ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800';

            return (
              <div key={action.id} className="px-6 py-4 hover:bg-gray-50">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${priorityColor}`}>
                        #{index + 1}
                      </span>
                      <span className="text-sm font-medium text-gray-900">{action.leadName}</span>
                      <span className="text-xs text-gray-500">{action.address}</span>
                    </div>
                    <div className="text-sm text-gray-900 mb-1">
                      <span className="font-medium">Action:</span> {action.action}
                    </div>
                    <div className="text-xs text-gray-600">
                      {action.reason?.reasoning || 'No reasoning provided'}
                    </div>
                  </div>
                  <div className="ml-4 text-right">
                    <div className="text-sm font-semibold text-gray-900">
                      Priority: {Math.round(action.priority).toLocaleString()}
                    </div>
                    <button className="mt-2 px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">
                      Execute
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
